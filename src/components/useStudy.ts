"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { checkSeqAndRemember, rememberSavedSeq } from "@/components/SeqAlarm";
import { STUDY_CONTEXT } from "@/lib/aevcontext";
import { sydneyToday } from "@/lib/fin";
import { nextSeq } from "@/lib/seqrule";
import {
  EMPTY_STUDY,
  addStudy,
  MAX_STUDY_SOURCE,
  normalizeStudy,
  type StudyConfig,
} from "@/lib/study";

export interface Study {
  /** The decrypted log — non-null once it has been loaded and opened. */
  cfg: StudyConfig | null;
  /** The vault's own state, for the lock-edge resets a surface owns itself. */
  unlocked: boolean;
  /** How the load failed, for the surface to say so in its own register. */
  dataErr: "unreachable" | "tamper" | null;
  seqAlarm: boolean;
  busy: boolean;
  save: (apply: (base: StudyConfig) => StudyConfig) => Promise<boolean>;
  /** Log one sitting, today — the single write both surfaces make. */
  log: (source: string, minutes?: number) => Promise<boolean>;
}

/**
 * The `meta/study` envelope, as one hook — the `useTodo` shape exactly: fetch,
 * decrypt, normalize, and the seal → PUT → retry-once-on-409 save every write
 * goes through. Two surfaces write the log — the reader's japan lane and the
 * palette's `ja` verb — and they share this hook so they cannot drift: one
 * load path, one save path, one write counter between them.
 *
 * Client-only machinery: the server moves ciphertext and never sees a source.
 * Nothing is held past the lock, and nothing is optimistic — a sitting is in
 * the log after it is sealed, not before. A refused row (malformed, or a full
 * log) is a failed save, never a ✓ over an unchanged envelope.
 */
export function useStudy(offline: boolean): Study {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<StudyConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Render-phase reset on the lock/unlock edge (the glance idiom): decrypted
  // sittings leave with the key. A surface resets its own composer off
  // `unlocked` for the same reason.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
  }

  // Load + decrypt once per unlock. A healthy 404 is first-run; anything else
  // must never look like it (the keystore lesson).
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let config: StudyConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/study");
        if (res.status === 404) {
          config = EMPTY_STUDY;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, STUDY_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeStudy(parsed);
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
      void checkSeqAndRemember("study", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: StudyConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "study.json", t: "application/json", s: bytes.length },
      bytes,
      STUDY_CONTEXT,
    );
    const res = await fetch("/api/study", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-study-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("study", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<StudyConfig> {
    const res = await fetch("/api/study");
    if (res.status === 404) return EMPTY_STUDY;
    if (res.status !== 200) throw new Error("study refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, STUDY_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeStudy(parsed);
    if (!config) throw new Error("study refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config
   *  on a 409 (the other device may have logged meanwhile). */
  async function save(
    apply: (base: StudyConfig) => StudyConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    setBusy(true);
    try {
      // Unchanged means the row was refused — reported, not written.
      let next = apply(cfg);
      if (next === cfg) return false;
      let result = await putConfig(next, configExisted);
      if (result === "conflict") {
        const base = await fetchConfigFresh();
        next = apply(base);
        if (next === base) return false;
        result = await putConfig(next, true);
      }
      if (result !== "ok") return false;
      setCfg(next);
      setConfigExisted(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    cfg,
    unlocked,
    dataErr,
    seqAlarm,
    busy,
    save,
    log: (source: string, minutes?: number) =>
      save((base) =>
        addStudy(base, {
          date: sydneyToday(),
          // A headline longer than the log's cap is kept, cut to fit.
          source: source.trim().slice(0, MAX_STUDY_SOURCE),
          ...(minutes !== undefined ? { minutes } : {}),
        }),
      ),
  };
}
