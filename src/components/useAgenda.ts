"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { checkSeqAndRemember, rememberSavedSeq } from "@/components/SeqAlarm";
import { AGENDA_CONTEXT } from "@/lib/aevcontext";
import {
  EMPTY_AGENDA_CONFIG,
  fitsAgendaCap,
  normalizeAgendaConfig,
  pruneCutoff,
  pruneEvents,
  type AgendaConfig,
} from "@/lib/agenda";
import { nextSeq } from "@/lib/seqrule";

/** Where the schedule is between locked and readable. `ready` is the only status
 *  that comes with a `cfg`; the other four are what a surface renders instead. */
export type AgendaStatus =
  | "locked"
  | "loading"
  | "unreachable"
  | "tamper"
  | "ready";

export interface Agenda {
  status: AgendaStatus;
  /** The decrypted schedule — non-null exactly when `status` is `ready`. */
  cfg: AgendaConfig | null;
  /** The vault's own state, for the lock-edge resets a surface owns itself. */
  unlocked: boolean;
  busy: boolean;
  notice: string | null;
  seqAlarm: boolean;
  saveConfig: (apply: (base: AgendaConfig) => AgendaConfig) => Promise<boolean>;
  /** Drop a stale save notice when a surface starts a fresh compose. */
  clearNotice: () => void;
}

/**
 * The `meta/agenda` envelope, as one hook: fetch, decrypt, normalize, and the
 * seal → PUT → retry-once-on-409 save every edit goes through. Two surfaces read
 * the same schedule — the homepage glance and /agenda — and they share this hook
 * precisely so they cannot drift: one load path, one save path, one honest set of
 * failure states between them.
 *
 * Every event lives in that envelope, so this is client-only machinery: the
 * server moves ciphertext and never sees a title. Nothing is held past the lock —
 * the decrypted schedule leaves the moment the vault does.
 *
 * Failure is reported rather than swallowed: a healthy 404 is first-run, but a
 * tampered envelope or an unreachable store gets the honest register. BOTH
 * surfaces show it — silent dots would hide the one signal the owner could act
 * on, and this is the store's only window.
 *
 * Every save re-applies a PURE transform against freshly-fetched state on a
 * conflict, so adding a shift on the phone while the PC has a page open can't
 * lose either. This store WRITES, so it owns the rollback check (58b) the
 * read-only glances skip. Nothing is optimistic: an event is on the page after it
 * is sealed, not before.
 */
export function useAgenda(offline: boolean, today: string): Agenda {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<AgendaConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // schedule leaves with the key. A surface resets its own composer off
  // `unlocked` for the same reason — anything half-typed about the schedule goes
  // with it.
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
      let config: AgendaConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/agenda");
        if (res.status === 404) {
          config = EMPTY_AGENDA_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, AGENDA_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeAgendaConfig(parsed);
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
      // Rollback check (58b) — a 404 for a schedule this device has seen alarms too.
      void checkSeqAndRemember("agenda", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: AgendaConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "agenda.json", t: "application/json", s: bytes.length },
      bytes,
      AGENDA_CONTEXT,
    );
    const res = await fetch("/api/agenda", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-agenda-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("agenda", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<AgendaConfig> {
    const res = await fetch("/api/agenda");
    if (res.status === 404) return EMPTY_AGENDA_CONFIG;
    if (res.status !== 200) throw new Error("agenda refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, AGENDA_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeAgendaConfig(parsed);
    if (!config) throw new Error("agenda refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config on
   *  a 409 (the other device may have booked something meanwhile). Every save
   *  prunes the grace week behind it, so the past leaves without a chore. */
  async function saveConfig(
    apply: (base: AgendaConfig) => AgendaConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    const next = (base: AgendaConfig) =>
      pruneEvents(apply(base), pruneCutoff(today));
    setBusy(true);
    setNotice(null);
    try {
      let base = cfg;
      // The cap is client-side law — refuse with a reason rather than let the
      // route answer an opaque 404 on an oversized frame.
      if (!fitsAgendaCap(next(base))) {
        setNotice("agenda is full — the envelope cap is reached");
        return false;
      }
      let result = await putConfig(next(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(next(base), true);
      }
      if (result !== "ok") {
        setNotice("could not save — try again");
        return false;
      }
      setCfg(next(base));
      setConfigExisted(true);
      return true;
    } catch {
      setNotice("could not save — try again");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const status: AgendaStatus =
    dataErr ?? (cfg ? "ready" : unlocked ? "loading" : "locked");

  return {
    status,
    cfg,
    unlocked,
    busy,
    notice,
    seqAlarm,
    saveConfig,
    clearNotice: () => setNotice(null),
  };
}
