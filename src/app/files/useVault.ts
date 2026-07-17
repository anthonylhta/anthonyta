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
 * Lock wipes both the in-memory handle and the IndexedDB cache; boot also drops
 * a cache left idle past IDLE_LOCK_MS so a stolen unlocked device can't read on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildKeystore,
  checkCanary,
  fromB64url,
  generateMk,
  isArgonKdf,
  isKeystore,
  open,
  seal,
  sealCanary,
  toB64url,
  unwrapMk,
  wrapMk,
  type EnvelopeMeta,
  type Keystore,
} from "@/lib/crypto";
import { deriveKekForKdf, freshKdf } from "@/lib/kdf";
import { deriveKekFromPrf, findWrap, isPrfWrapSet } from "@/lib/prf";
import {
  clearCachedKey,
  getActivityStamp,
  getCachedKey,
  isIdleStale,
  setCachedKey,
  touchActivityStamp,
} from "@/lib/keycache";
import { runPrfCeremony } from "./prfCeremony";
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
  context?: string,
): Promise<Uint8Array> {
  if (bytes.length < WORKER_MIN_BYTES) return seal(mk, meta, bytes, context);
  try {
    // Copy before transfer so the fallback (and the caller) keep `bytes` usable.
    const buf = bytes.slice().buffer as ArrayBuffer;
    const resp = await callWorker(
      { id: ++seq, op: "seal", mk, meta, buf, context },
      [buf],
    );
    if (!resp.ok) throw new Error("seal failed");
    return new Uint8Array(resp.buf);
  } catch (err) {
    if (err instanceof Error && err.message === WORKER_BROKEN)
      return seal(mk, meta, bytes, context);
    throw err;
  }
}

async function openBytes(
  mk: CryptoKey,
  envelope: Uint8Array,
  context?: string,
): Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }> {
  if (envelope.length < WORKER_MIN_BYTES) return open(mk, envelope, context);
  try {
    const buf = envelope.slice().buffer as ArrayBuffer;
    const resp = await callWorker({ id: ++seq, op: "open", mk, buf, context }, [
      buf,
    ]);
    if (!resp.ok || !resp.meta) throw new Error("cannot decrypt");
    return { meta: resp.meta, bytes: new Uint8Array(resp.buf) };
  } catch (err) {
    if (err instanceof Error && err.message === WORKER_BROKEN)
      return open(mk, envelope, context);
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

/**
 * Opportunistic v1 → v2 heal: a keystore with no canary gets one sealed under the
 * just-unlocked MK and written back (the one legitimate overwrite — the same MK,
 * one added field). Best-effort: a v2 keystore or any write failure returns the
 * input untouched and it simply heals on the next unlock. Returns whatever
 * keystore is now at rest.
 */
async function healCanary(mk: CryptoKey, ks: Keystore): Promise<Keystore> {
  if (ks.v === 2) return ks;
  try {
    const next: Keystore = { ...ks, v: 2, canary_b64: await sealCanary(mk) };
    if ((await putKeystore(next, true)) === "ok") return next;
  } catch {
    // best-effort — leave the v1 keystore in place, heal later
  }
  return ks;
}

/**
 * Lazy pbkdf2 → argon2id migration (ADR: Argon2id), run right after a
 * successful passphrase unlock while the verified KEK is still in hand: unwrap
 * the MK momentarily-extractable (the passphrase-change idiom — WebCrypto
 * refuses to wrap a non-extractable key), re-wrap it under a fresh Argon2id
 * KEK, overwrite the keystore. Same MK, same canary, new wrapping — every
 * other device keeps unlocking, they just derive differently next time.
 * Best-effort at every step: an argon2id keystore, a WASM that can't run, or
 * any failure returns the input untouched and it retries on the next unlock.
 */
async function migrateKdf(
  ks: Keystore,
  kek: CryptoKey,
  passphrase: string,
): Promise<Keystore> {
  if (isArgonKdf(ks.kdf)) return ks;
  try {
    const kdf = await freshKdf();
    if (!isArgonKdf(kdf)) return ks; // WASM unavailable — stay on pbkdf2
    // Momentarily-extractable unwrap, discarded as soon as the new wrap exists.
    const tempMk = await unwrapMk(
      fromB64url(ks.wrapped_mk_b64),
      fromB64url(ks.iv_b64),
      kek,
      true,
    );
    const newKek = await deriveKekForKdf(kdf, passphrase);
    const { wrapped, iv } = await wrapMk(tempMk, newKek);
    const next: Keystore = {
      ...ks,
      kdf,
      wrapped_mk_b64: toB64url(wrapped),
      iv_b64: toB64url(iv),
    };
    if ((await putKeystore(next, true)) === "ok") return next;
    return ks;
  } catch {
    return ks;
  }
}

/**
 * Fetch the PRF wrap set for a passkey unlock. A healthy 404 (no device enrolled)
 * and any hiccup both collapse to `null` — passkey unlock is convenience layered
 * on the passphrase, so "no usable wrap" always just falls back to the box; there
 * is no fresh-key path here to protect, unlike the keystore fetch.
 */
async function fetchPrfWrapSet() {
  const res = await fetch("/api/prf/wrap");
  if (!res.ok) return null;
  const parsed: unknown = await res.json();
  return isPrfWrapSet(parsed) ? parsed : null;
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
  /** Unlock via a passkey's PRF secret instead of the passphrase. A missing or
   *  wrong wrap surfaces an error and stays locked — the passphrase box remains. */
  unlockWithPasskey: () => Promise<void>;
  /** Encrypt one item under the unlocked MK. Throws when locked. Pass the blob's
   *  storage path as `context` to seal an AEV2 (address-bound) envelope; omit it
   *  for a legacy AEV1 envelope (ADR 0073). */
  sealItem: (
    meta: EnvelopeMeta,
    bytes: Uint8Array,
    context?: string,
  ) => Promise<Uint8Array>;
  /** Decrypt one envelope. Throws on tamper/garbage or when locked. For an AEV2
   *  envelope, `context` MUST be the path it was sealed under (a wrong/absent path
   *  fails like tampering); it is ignored for a legacy AEV1 envelope. */
  openItem: (
    envelope: Uint8Array,
    context?: string,
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
        const [cached, stamp, ks] = await Promise.all([
          getCachedKey(),
          getActivityStamp(),
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
          // Idle auto-lock: a cache untouched past IDLE_LOCK_MS is a known-stale
          // key, not an error — drop it and land locked.
          if (stamp !== null && isIdleStale(stamp, Date.now())) {
            await clearCachedKey();
            if (!cancelled) setStatus("locked");
            return;
          }
          // Canary: prove the cached key still belongs to THIS keystore before
          // trusting it. A vault reset on another device mints a fresh MK the
          // stale cache can't open — a KNOWN-stale key, so drop it and land
          // locked (never `error`: that's for a flaky fetch, and misreading a
          // stale key as one would leave a broken cache in place). A v1 keystore
          // has no canary ("absent") → skip and behave exactly as before.
          if ((await checkCanary(cached, ks)) === false) {
            await clearCachedKey();
            if (!cancelled) setStatus("locked");
            return;
          }
          if (cancelled) return;
          // Fresh, or an absent stamp (a pre-feature device with a key but no
          // stamp): roll the window forward now — locking every old device out
          // on deploy would be a surprise. This boot touch IS the rolling signal.
          await touchActivityStamp();
          if (cancelled) return;
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
      // New vaults are Argon2id from birth (freshKdf degrades to PBKDF2 only
      // when the WASM can't run here — ADR: Argon2id).
      const kdf = await freshKdf();
      const kek = await deriveKekForKdf(kdf, passphrase);
      const mk0 = await generateMk();
      const { wrapped, iv } = await wrapMk(mk0, kek);
      // Seal the canary under the fresh MK so the very first keystore is v2.
      const ks = buildKeystore(kdf, wrapped, iv, await sealCanary(mk0));
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
      await touchActivityStamp();
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
      // Derive with whatever the keystore says — pbkdf2 or argon2id.
      const kek = await deriveKekForKdf(ks.kdf, passphrase);
      // A wrong passphrase fails this unwrap's GCM auth check — that throw IS
      // the passphrase verdict; there's no verifier to compare against.
      const mk = await unwrapMk(
        fromB64url(ks.wrapped_mk_b64),
        fromB64url(ks.iv_b64),
        kek,
      );
      mkRef.current = mk;
      await setCachedKey(mk);
      await touchActivityStamp();
      // Heal a legacy v1 keystore now that the MK is in hand, then lazily
      // migrate a pbkdf2 wrap to argon2id — every keystore upgrades the first
      // time it's opened, and one that's never opened never needed to.
      const healed = await healCanary(mk, ks);
      ksRef.current = await migrateKdf(healed, kek, passphrase);
      setStatus("unlocked");
    } catch {
      setError("wrong passphrase");
    } finally {
      setWorking(false);
    }
  }, []);

  const unlockWithPasskey = useCallback(async () => {
    const ks = ksRef.current;
    if (!ks) return;
    setWorking(true);
    setError(null);
    try {
      // Ceremony FIRST, right off the click: no await before it so the transient
      // user-activation window from the gesture is spent on the credential prompt.
      const prf = await runPrfCeremony();
      if (!prf) throw new Error("no prf secret");
      const set = await fetchPrfWrapSet();
      const wrap = set ? findWrap(set, prf.credentialIdB64) : null;
      if (!wrap) throw new Error("no wrap for this passkey");
      const kek = await deriveKekFromPrf(prf.secret);
      // A wrong/rotated wrap fails this unwrap's GCM auth check — that throw drops
      // us back to the passphrase, exactly like a wrong passphrase would.
      const mk = await unwrapMk(
        fromB64url(wrap.wrapped_mk_b64),
        fromB64url(wrap.iv_b64),
        kek,
      );
      // Leaves the vault exactly as the passphrase path does: the SAME
      // non-extractable MK in memory and the IDB keycache.
      mkRef.current = mk;
      await setCachedKey(mk);
      await touchActivityStamp();
      // Same MK as the keystore wraps — heal a legacy v1 keystore here too.
      ksRef.current = await healCanary(mk, ks);
      setStatus("unlocked");
    } catch {
      setError("passkey unlock unavailable — use your passphrase");
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
        const oldKek = await deriveKekForKdf(ks.kdf, oldPass);
        // Momentarily-extractable unwrap: the only way to re-wrap. The handle
        // is discarded as soon as the new wrap exists.
        const tempMk = await unwrapMk(
          fromB64url(ks.wrapped_mk_b64),
          fromB64url(ks.iv_b64),
          oldKek,
          true,
        );
        const kdf = await freshKdf();
        const newKek = await deriveKekForKdf(kdf, newPass);
        const { wrapped, iv } = await wrapMk(tempMk, newKek);
        // Refresh the canary under the SAME MK — it stays valid on every other
        // device (they still hold this MK), and a v1 keystore heals to v2 here.
        const next = buildKeystore(kdf, wrapped, iv, await sealCanary(tempMk));
        // The one legitimate overwrite: same MK, new wrapping.
        if ((await putKeystore(next, true)) !== "ok")
          throw new Error("keystore write failed");
        const mk = await unwrapMk(wrapped, iv, newKek);
        ksRef.current = next;
        mkRef.current = mk;
        await setCachedKey(mk);
        await touchActivityStamp();
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
    async (meta: EnvelopeMeta, bytes: Uint8Array, context?: string) => {
      const mk = mkRef.current;
      if (!mk) throw new Error("locked");
      return sealBytes(mk, meta, bytes, context);
    },
    [],
  );

  const openItem = useCallback(
    async (envelope: Uint8Array, context?: string) => {
      const mk = mkRef.current;
      if (!mk) throw new Error("locked");
      return openBytes(mk, envelope, context);
    },
    [],
  );

  return useMemo(
    () => ({
      status,
      error,
      working,
      setup,
      unlock,
      unlockWithPasskey,
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
      unlockWithPasskey,
      lock,
      changePassphrase,
      sealItem,
      openItem,
    ],
  );
}
