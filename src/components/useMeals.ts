"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { checkSeqAndRemember, rememberSavedSeq } from "@/components/SeqAlarm";
import { MEALS_CONTEXT } from "@/lib/aevcontext";
import { sydneyToday } from "@/lib/fin";
import {
  EMPTY_MEALS_CONFIG,
  fitsMealsCap,
  foldOldDays,
  normalizeMealsConfig,
  type MealsConfig,
} from "@/lib/meals";
import { nextSeq } from "@/lib/seqrule";

export interface Meals {
  /** The decrypted log — non-null once it has been loaded and opened. */
  cfg: MealsConfig | null;
  /** The vault's own state, for the lock-edge resets a surface owns itself. */
  unlocked: boolean;
  /** How the load failed, for the surface to say so in its own register. */
  dataErr: "unreachable" | "tamper" | null;
  seqAlarm: boolean;
  busy: boolean;
  /** Why the last save refused, in the log's own words — the cap, or a failure. */
  notice: string | null;
  save: (apply: (base: MealsConfig) => MealsConfig) => Promise<boolean>;
}

/**
 * The `meta/meals` envelope, as one hook: fetch, decrypt, normalize, and the
 * seal → PUT → retry-once-on-409 save every edit goes through — the useTodo
 * precedent, for the same reason. The meal log is no longer the only surface
 * writing to this store (⌘K logs a weigh-in without opening the page), and two
 * hand-rolled copies of a save path are two copies that can drift: one load
 * path, one save path, one write counter between them.
 *
 * Every entry lives in that envelope, so this is client-only machinery: the
 * server moves ciphertext and never sees a gram of it. Nothing is held past the
 * lock — the decrypted log leaves the moment the vault does.
 *
 * Failure is reported rather than swallowed: a healthy 404 is first-run, but a
 * tampered envelope or an unreachable store gets its own state, and the surface
 * decides how loudly to say it.
 *
 * Every save re-applies a PURE transform against freshly-fetched state on a
 * conflict, so logging lunch on the phone while the PC has the page open can't
 * lose either. This store WRITES, so it owns the rollback check (58b). Nothing
 * is optimistic: an entry is in the log after it is sealed, not before.
 */
export function useMeals(offline: boolean): Meals {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<MealsConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // log leaves with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
    setNotice(null);
  }

  // Load + decrypt once per unlock. A healthy 404 is first-run; anything else
  // must never look like it (the keystore lesson).
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let config: MealsConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/meals");
        if (res.status === 404) {
          config = EMPTY_MEALS_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, MEALS_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeMealsConfig(parsed);
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
      // Rollback check (58b) — a 404 for a log this device has seen alarms too.
      void checkSeqAndRemember("meals", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: MealsConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "meals.json", t: "application/json", s: bytes.length },
      bytes,
      MEALS_CONTEXT,
    );
    const res = await fetch("/api/meals", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-meals-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("meals", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<MealsConfig> {
    const res = await fetch("/api/meals");
    if (res.status === 404) return EMPTY_MEALS_CONFIG;
    if (res.status !== 200) throw new Error("meals refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, MEALS_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeMealsConfig(parsed);
    if (!config) throw new Error("meals refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config on
   *  a 409 (the other device may have logged something meanwhile). */
  async function save(
    apply: (base: MealsConfig) => MealsConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    setBusy(true);
    setNotice(null);
    try {
      let base = cfg;
      // Every save is also when the log sheds what it no longer needs itemized:
      // days past the horizon fold to their totals. It rides here rather than in
      // any one transform because it belongs to the WRITE, and because the 409
      // dance re-applies this whole function against a fresh base.
      const today = sydneyToday();
      const applyAll = (from: MealsConfig) => foldOldDays(apply(from), today);
      // The cap is client-side law — refuse with a reason rather than let the
      // route answer an opaque 404 on an oversized frame.
      if (!fitsMealsCap(applyAll(base))) {
        setNotice("log is full — the envelope cap is reached");
        return false;
      }
      let result = await putConfig(applyAll(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(applyAll(base), true);
      }
      if (result !== "ok") {
        setNotice("could not save — try again");
        return false;
      }
      setCfg(applyAll(base));
      setConfigExisted(true);
      return true;
    } catch {
      setNotice("could not save — try again");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { cfg, unlocked, dataErr, seqAlarm, busy, notice, save };
}
