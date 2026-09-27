"use client";

import { useEffect, useState } from "react";
import { useVault, type Vault } from "@/app/files/useVault";
import { checkSeqAndRemember, rememberSavedSeq } from "@/components/SeqAlarm";
import { FIN_CONTEXT } from "@/lib/aevcontext";
import { normalizeFinConfig, type FinConfig } from "@/lib/fin";
import { nextSeq } from "@/lib/seqrule";

/** A first-run ledger — what a healthy 404 means. */
const EMPTY_FIN: FinConfig = {
  v: 2,
  entries: [],
  invested: [],
  portfolio: null,
};

export interface Fin {
  /** The vault this hook opens and seals with — the panel's unlock box drives
   *  the SAME instance, so unlocking there is what loads the ledger here. */
  vault: Vault;
  /** The decrypted ledger — non-null once it has been loaded and opened. */
  cfg: FinConfig | null;
  unlocked: boolean;
  /** How the load failed, for the surface to say so in its own register. */
  dataErr: "unreachable" | "tamper" | null;
  seqAlarm: boolean;
  save: (apply: (base: FinConfig) => FinConfig) => Promise<boolean>;
}

/**
 * The `meta/fin` envelope, as one hook: fetch, decrypt, normalize, and the
 * seal → PUT → retry-once-on-409 save every edit goes through — lifted out of
 * the /portfolio panel on the useMeals precedent (ADR 0188), for the same
 * reason. The panel is no longer the only surface writing this store (⌘K logs
 * a pay-in without opening the page), and two hand-rolled copies of a save path
 * are two copies that can drift: one load path, one save path, one write
 * counter between them.
 *
 * Client-only machinery: the server moves ciphertext and never sees a figure.
 * Nothing is held past the lock — the decrypted ledger leaves with the key.
 *
 * A flake must never read as an empty (re-seedable) ledger, so only a healthy
 * 404 is first-run; a 503/network is `unreachable`, a bad envelope `tamper`.
 * Every save re-applies a PURE transform against freshly-fetched state on a
 * conflict, so the phone and the desk can't lose each other's edits. This
 * store WRITES, so it owns the rollback check (58b).
 */
export function useFin(offline: boolean): Fin {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<FinConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);

  // Render-phase reset on the lock/unlock edge (the lint-blessed pattern): the
  // decrypted ledger leaves with the key.
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (prevUnlocked !== unlocked) {
    setPrevUnlocked(unlocked);
    setDataErr(null);
    setCfg(null);
  }

  // Load + decrypt once per unlock. A cancelled flag drops a late resolve after
  // lock/unmount. `openItem` is a stable callback, so [unlocked, openItem] fires
  // exactly on the lock→unlock edge, never on the working-flag flicker.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      let config: FinConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/fin/config");
        if (res.status === 404) {
          config = EMPTY_FIN;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, FIN_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeFinConfig(parsed);
            if (!config) throw new Error("bad shape");
            existed = true;
          } catch {
            if (!cancelled) setDataErr("tamper");
            return;
          }
        } else {
          if (!cancelled) setDataErr("unreachable");
          return;
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
        return;
      }

      if (cancelled) return;
      setCfg(config);
      setConfigExisted(existed);
      // Rollback check (58b): both branches land here — a 404 for a ledger
      // this device has seen reads as seq 0 and trips the same alarm.
      if (await checkSeqAndRemember("fin", config)) {
        if (!cancelled) setSeqAlarm(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  // Seal `next` and PUT it — overwrite iff a remote config already existed.
  async function putConfig(
    next: FinConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b). The prior is whichever is newer of
    // the loaded state and `next` itself (a 409-dance rebuild derives from a
    // fresh fetch that carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "fin.json", t: "application/json", s: bytes.length },
      bytes,
      FIN_CONTEXT,
    );
    const res = await fetch("/api/fin/config", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-fin-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("fin", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<FinConfig> {
    const res = await fetch("/api/fin/config");
    if (res.status === 404) return EMPTY_FIN;
    if (res.status !== 200) throw new Error("config refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, FIN_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeFinConfig(parsed);
    if (!config) throw new Error("config refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a freshly
   *  fetched config on a 409 (another device may have written meanwhile). */
  async function save(apply: (base: FinConfig) => FinConfig): Promise<boolean> {
    if (!cfg) return false;
    try {
      let base = cfg;
      let result = await putConfig(apply(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(apply(base), true);
      }
      if (result !== "ok") return false;
      setCfg(apply(base));
      setConfigExisted(true);
      return true;
    } catch {
      return false;
    }
  }

  return { vault, cfg, unlocked, dataErr, seqAlarm, save };
}
