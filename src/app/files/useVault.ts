"use client";

/**
 * useVault — the client state machine around the E2EE key lifecycle (ADR 0053).
 *
 *   offline → (store has no token; crypto UI hidden entirely)
 *   loading → probing the keycache + fetching the keystore
 *   setup   → no keystore exists yet: first-run passphrase creation
 *   locked  → keystore exists, no cached key: passphrase prompt
 *   unlocked→ master key in memory (+ IndexedDB for the next launch)
 *
 * The unlock screen IS the security boundary — everything below it (seal/open,
 * the worker, the raw route) only ever sees the non-extractable master key.
 * Lock wipes both the in-memory handle and the IndexedDB cache.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildKeystore,
  deriveKek,
  fromB64url,
  generateMk,
  isKeystore,
  ITERATIONS,
  open,
  randomSalt,
  seal,
  unwrapMk,
  wrapMk,
  type EnvelopeMeta,
  type Keystore,
} from "@/lib/crypto";
import { clearCachedKey, getCachedKey, setCachedKey } from "@/lib/keycache";
import type { WorkerRequest, WorkerResponse } from "./crypto.worker";

export type VaultStatus =
  | "offline"
  | "loading"
  | "setup"
  | "locked"
  | "unlocked"
  /** The keystore couldn't be reached (network/store hiccup). Deliberately NOT
   *  setup: mistaking a flaky fetch for a first run would mint a fresh master
   *  key and orphan everything already encrypted. Reload to retry. */
  | "error";

/** Payloads below this skip the worker — the postMessage round-trip costs more
 *  than encrypting a note inline. */
const WORKER_MIN_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// worker bridge — one lazy shared worker, falling back to the main thread if
// construction or loading fails (lib/crypto runs identically in both places)
// ---------------------------------------------------------------------------

const WORKER_BROKEN = "worker broken";

let worker: Worker | null | undefined; // undefined = untried, null = retired
let seq = 0;
const pending = new Map<
  number,
  { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./crypto.worker.ts", import.meta.url));
    worker.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (p) {
        pending.delete(e.data.id);
        p.resolve(e.data);
      }
    });
    worker.addEventListener("error", () => {
      // Script failed to load or blew up — retire it and push every in-flight
      // call onto the main-thread fallback.
      for (const p of pending.values()) p.reject(new Error(WORKER_BROKEN));
      pending.clear();
      worker?.terminate();
      worker = null;
    });
  } catch {
    worker = null;
  }
  return worker;
}

function callWorker(
  req: WorkerRequest,
  transfer: ArrayBuffer[],
): Promise<WorkerResponse> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error(WORKER_BROKEN));
  return new Promise((resolve, reject) => {
    pending.set(req.id, { resolve, reject });
    w.postMessage(req, transfer);
  });
}

async function sealBytes(
  mk: CryptoKey,
  meta: EnvelopeMeta,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (bytes.length < WORKER_MIN_BYTES) return seal(mk, meta, bytes);
  try {
    // Copy before transfer so the fallback (and the caller) keep `bytes` usable.
    const buf = bytes.slice().buffer as ArrayBuffer;
    const resp = await callWorker({ id: ++seq, op: "seal", mk, meta, buf }, [
      buf,
    ]);
    if (!resp.ok) throw new Error("seal failed");
    return new Uint8Array(resp.buf);
  } catch (err) {
    if (err instanceof Error && err.message === WORKER_BROKEN)
      return seal(mk, meta, bytes);
    throw err;
  }
}

async function openBytes(
  mk: CryptoKey,
  envelope: Uint8Array,
): Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }> {
  if (envelope.length < WORKER_MIN_BYTES) return open(mk, envelope);
  try {
    const buf = envelope.slice().buffer as ArrayBuffer;
    const resp = await callWorker({ id: ++seq, op: "open", mk, buf }, [buf]);
    if (!resp.ok || !resp.meta) throw new Error("cannot decrypt");
    return { meta: resp.meta, bytes: new Uint8Array(resp.buf) };
  } catch (err) {
    if (err instanceof Error && err.message === WORKER_BROKEN)
      return open(mk, envelope);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// keystore fetch
// ---------------------------------------------------------------------------

/**
 * "absent" (a healthy 404 — first run) vs a THROW (network error, 5xx, malformed
 * body). The two must never blur: absent leads to setup, and setup writes a fresh
 * master key — treating a hiccup as absence would orphan every encrypted item.
 */
async function fetchKeystore(): Promise<Keystore | "absent"> {
  const res = await fetch("/api/files/keystore");
  if (res.status === 404) return "absent";
  if (!res.ok) throw new Error(`keystore fetch: ${res.status}`);
  const parsed: unknown = await res.json();
  if (!isKeystore(parsed)) throw new Error("keystore fetch: malformed");
  return parsed;
}

async function putKeystore(
  ks: Keystore,
  overwrite: boolean,
): Promise<"ok" | "conflict" | "failed"> {
  try {
    const res = await fetch("/api/files/keystore", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(overwrite ? { "x-keystore-overwrite": "1" } : {}),
      },
      body: JSON.stringify(ks),
    });
    if (res.status === 409) return "conflict";
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// the hook
// ---------------------------------------------------------------------------

export interface Vault {
  status: VaultStatus;
  /** Last user-facing failure ("wrong passphrase", …); cleared on the next attempt. */
  error: string | null;
  /** True while a KDF derivation / keystore write is in flight (~1s on mobile). */
  working: boolean;
  setup: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
  changePassphrase: (oldPass: string, newPass: string) => Promise<boolean>;
  /** Encrypt one item under the unlocked MK. Throws when locked. */
  sealItem: (meta: EnvelopeMeta, bytes: Uint8Array) => Promise<Uint8Array>;
  /** Decrypt one envelope. Throws on tamper/garbage or when locked. */
  openItem: (
    envelope: Uint8Array,
  ) => Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }>;
}

export function useVault(offline: boolean): Vault {
  const [status, setStatus] = useState<VaultStatus>(
    offline ? "offline" : "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const mkRef = useRef<CryptoKey | null>(null);
  const ksRef = useRef<Keystore | null>(null);

  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    (async () => {
      try {
        const [cached, ks] = await Promise.all([
          getCachedKey(),
          fetchKeystore(),
        ]);
        if (cancelled) return;
        if (ks === "absent") {
          // A HEALTHY read found no keystore: genuine first run, so any cached
          // key is stale (e.g. the store was reset elsewhere).
          await clearCachedKey();
          if (!cancelled) setStatus("setup");
          return;
        }
        ksRef.current = ks;
        if (cached) {
          // Known limitation: nothing binds the cached key to THIS keystore. If
          // the vault was reset on another device, decrypts fail row-by-row
          // until a lock/unlock refreshes the key — the keystore carries no key
          // id to compare against.
          mkRef.current = cached;
          setStatus("unlocked");
        } else {
          setStatus("locked");
        }
      } catch {
        // Transient failure — keep the cached key untouched and surface an
        // error state rather than misreading this as a first run.
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offline]);

  const setup = useCallback(async (passphrase: string) => {
    setWorking(true);
    setError(null);
    try {
      const salt = randomSalt();
      const kek = await deriveKek(passphrase, salt);
      const mk0 = await generateMk();
      const { wrapped, iv } = await wrapMk(mk0, kek);
      const ks = buildKeystore(salt, ITERATIONS, wrapped, iv);
      // No-overwrite write: if a vault already exists (this state was reached
      // by mistake), the server refuses rather than orphaning its data.
      const wrote = await putKeystore(ks, false);
      if (wrote === "conflict") {
        setError("a vault already exists — reload the page");
        return;
      }
      if (wrote !== "ok") throw new Error("keystore write failed");
      // Discard the extractable handle (mk0); from here on only the
      // non-extractable unwrap result exists.
      const mk = await unwrapMk(wrapped, iv, kek);
      ksRef.current = ks;
      mkRef.current = mk;
      await setCachedKey(mk);
      setStatus("unlocked");
    } catch {
      setError("setup failed — try again");
    } finally {
      setWorking(false);
    }
  }, []);

  const unlock = useCallback(async (passphrase: string) => {
    const ks = ksRef.current;
    if (!ks) return;
    setWorking(true);
    setError(null);
    try {
      const kek = await deriveKek(
        passphrase,
        fromB64url(ks.kdf.salt_b64),
        ks.kdf.iterations,
      );
      // A wrong passphrase fails this unwrap's GCM auth check — that throw IS
      // the passphrase verdict; there's no verifier to compare against.
      const mk = await unwrapMk(
        fromB64url(ks.wrapped_mk_b64),
        fromB64url(ks.iv_b64),
        kek,
      );
      mkRef.current = mk;
      await setCachedKey(mk);
      setStatus("unlocked");
    } catch {
      setError("wrong passphrase");
    } finally {
      setWorking(false);
    }
  }, []);

  const lock = useCallback(async () => {
    mkRef.current = null;
    await clearCachedKey();
    setError(null);
    setStatus(ksRef.current ? "locked" : "setup");
  }, []);

  const changePassphrase = useCallback(
    async (oldPass: string, newPass: string) => {
      const ks = ksRef.current;
      if (!ks) return false;
      setWorking(true);
      setError(null);
      try {
        const oldKek = await deriveKek(
          oldPass,
          fromB64url(ks.kdf.salt_b64),
          ks.kdf.iterations,
        );
        // Momentarily-extractable unwrap: the only way to re-wrap. The handle
        // is discarded as soon as the new wrap exists.
        const tempMk = await unwrapMk(
          fromB64url(ks.wrapped_mk_b64),
          fromB64url(ks.iv_b64),
          oldKek,
          true,
        );
        const salt = randomSalt();
        const newKek = await deriveKek(newPass, salt);
        const { wrapped, iv } = await wrapMk(tempMk, newKek);
        const next = buildKeystore(salt, ITERATIONS, wrapped, iv);
        // The one legitimate overwrite: same MK, new wrapping.
        if ((await putKeystore(next, true)) !== "ok")
          throw new Error("keystore write failed");
        const mk = await unwrapMk(wrapped, iv, newKek);
        ksRef.current = next;
        mkRef.current = mk;
        await setCachedKey(mk);
        setStatus("unlocked");
        return true;
      } catch {
        setError("change failed — check the current passphrase");
        return false;
      } finally {
        setWorking(false);
      }
    },
    [],
  );

  const sealItem = useCallback(
    async (meta: EnvelopeMeta, bytes: Uint8Array) => {
      const mk = mkRef.current;
      if (!mk) throw new Error("locked");
      return sealBytes(mk, meta, bytes);
    },
    [],
  );

  const openItem = useCallback(async (envelope: Uint8Array) => {
    const mk = mkRef.current;
    if (!mk) throw new Error("locked");
    return openBytes(mk, envelope);
  }, []);

  return useMemo(
    () => ({
      status,
      error,
      working,
      setup,
      unlock,
      lock,
      changePassphrase,
      sealItem,
      openItem,
    }),
    [
      status,
      error,
      working,
      setup,
      unlock,
      lock,
      changePassphrase,
      sealItem,
      openItem,
    ],
  );
}
