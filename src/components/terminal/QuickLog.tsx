"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVault } from "@/app/files/useVault";
import { rememberSavedSeq } from "@/components/SeqAlarm";
import { useMeals } from "@/components/useMeals";
import { useTodo } from "@/components/useTodo";
import { GU_MARKS_CONTEXT } from "@/lib/aevcontext";
import { sydneyToday } from "@/lib/fin";
import {
  EMPTY_GU_MARKS,
  normalizeGuMarks,
  withFreeCast,
  type GuMarksConfig,
} from "@/lib/gumarks";
import { setWeight } from "@/lib/meals";
import { DEFAULT_NOW, normalizeNow, setLine, type NowConfig } from "@/lib/now";
import { nextSeq } from "@/lib/seqrule";
import {
  parseQuickLog,
  quickLogLabel,
  quickLogSaved,
  type QuickLogAction,
} from "@/lib/quicklog";

/** How long the ✓ holds before the palette closes itself — long enough to be
 *  read, short enough that nobody waits on it. */
const SAVED_MS = 800;

/**
 * What the section tells the palette. `owns` true means the list belongs to the
 * section — the navigation rows step aside — and `fire` is what ↵ does, null
 * while the write is in flight or the ✓ is up.
 */
export type StageLog = (owns: boolean, fire: (() => void) | null) => void;

export interface QuickLogProps {
  query: string;
  /** Close the palette — called once the write is written and seen. */
  onDone: () => void;
  onStage: StageLog;
}

/**
 * The ⌘K log section — the owner's two write verbs, `w <kg>` and `todo <text>`,
 * in the palette that is already the fastest thing on the hub. A weigh-in is
 * four keystrokes from anywhere instead of a page load, and a thought lands in
 * the capture list without leaving what it interrupted.
 *
 * This module exists ONLY for a browser holding the master key: the palette
 * imports it after the device key cache answers, so the verbs, the labels and
 * the store machinery below sit in a chunk the public face never asks for
 * (ADR 0022 — the vault-search precedent, for the same reason).
 *
 * Every write goes through the hook the matching page uses — `useMeals` for the
 * weigh-in, `useTodo` for the capture — so a line logged here is sealed, counted
 * and conflict-resolved exactly as one logged on /meals or the board. There is
 * no quick path to the store, only a quicker way to reach the one there is.
 */
export function QuickLog({ query, onDone, onStage }: QuickLogProps) {
  const text = query.trim();
  const action = useMemo(() => parseQuickLog(text, sydneyToday()), [text]);

  // Nothing readable typed: the palette is its navigating self. The staged rows
  // below publish for themselves.
  useEffect(() => {
    if (!action) onStage(false, null);
  }, [action, onStage]);
  // …and the palette forgets the section the moment it closes.
  useEffect(() => () => onStage(false, null), [onStage]);

  if (action) {
    if (action.kind === "weigh")
      return <WeighRow action={action} onDone={onDone} onStage={onStage} />;
    if (action.kind === "todo")
      return <CaptureRow action={action} onDone={onDone} onStage={onStage} />;
    if (action.kind === "cast")
      return <CastRow action={action} onDone={onDone} onStage={onStage} />;
    return <NowRow action={action} onDone={onDone} onStage={onStage} />;
  }

  // Mid-word, or plainly a jump: a section that can't read the query says
  // nothing at all rather than sitting under the results being useless.
  if (text) return null;

  return (
    <>
      <li className="mt-1 border-t border-hairline px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.2em] text-muted">
        log
      </li>
      {/* The section's one advertisement — the verbs, not a row to select. */}
      <li className="flex items-center justify-between px-3 py-2 text-sm text-muted">
        <span className="truncate">w 67.4 · todo … · now … · cast …</span>
        <span className="text-xs text-muted">type to log</span>
      </li>
    </>
  );
}

/** The weigh-in verb, over the meal log's own envelope — the same store, the
 *  same save, as the weigh-in field on /meals. */
function WeighRow({
  action,
  onDone,
  onStage,
}: {
  action: Extract<QuickLogAction, { kind: "weigh" }>;
  onDone: () => void;
  onStage: StageLog;
}) {
  // Never offline: this module is loaded only once a master key was found in the
  // device cache, which is proof the store is live and the vault is unlocked.
  const meals = useMeals(false);
  const row = useStaged({
    action,
    ready: meals.cfg !== null,
    storeErr: meals.dataErr !== null,
    write: () => meals.save((base) => setWeight(base, action.day, action.kg)),
    onDone,
    onStage,
  });
  return <ActionRow {...row} />;
}

/** The capture verb, over the quick-capture list — the same `capture` the board
 *  and /reader call. */
function CaptureRow({
  action,
  onDone,
  onStage,
}: {
  action: Extract<QuickLogAction, { kind: "todo" }>;
  onDone: () => void;
  onStage: StageLog;
}) {
  const todo = useTodo(false);
  const row = useStaged({
    action,
    ready: todo.cfg !== null,
    storeErr: todo.dataErr !== null,
    write: () => todo.capture(action.text),
    onDone,
    onStage,
  });
  return <ActionRow {...row} />;
}

/**
 * The front-door verb — one line of the lobby's "now" block, rewritten from
 * wherever I happen to be. The only one of the three that writes something a
 * STRANGER reads, and the only one over a plaintext store rather than an
 * envelope: the block is public words by design (lib/now), so there is nothing
 * here to unseal, and the route's owner gate is the whole guard.
 */
function NowRow({
  action,
  onDone,
  onStage,
}: {
  action: Extract<QuickLogAction, { kind: "now" }>;
  onDone: () => void;
  onStage: StageLog;
}) {
  const [cfg, setCfg] = useState<NowConfig | null>(null);
  const [dataErr, setDataErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/now");
        // The store is empty until the first save, and the route answers the
        // defaults — which are what the lobby is currently printing anyway.
        if (res.status === 404) {
          if (!cancelled) setCfg(DEFAULT_NOW);
          return;
        }
        if (!res.ok) throw new Error(`now: ${res.status}`);
        const parsed = normalizeNow(await res.json());
        if (!parsed) throw new Error("now: unreadable");
        if (!cancelled) setCfg(parsed);
      } catch {
        if (!cancelled) setDataErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const row = useStaged({
    action,
    ready: cfg !== null,
    storeErr: dataErr,
    write: async () => {
      if (!cfg) return false;
      const next = setLine(cfg, action.key, action.text);
      // Unchanged means the block is already full and this is a ninth key —
      // reported as a refused write rather than a ✓ over nothing.
      if (next === cfg) return false;
      const res = await fetch("/api/now", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) return false;
      setCfg(next);
      return true;
    },
    onDone,
    onStage,
  });
  return <ActionRow {...row} />;
}

/**
 * The cast verb — a one-shot spend logged the moment it happens rather than
 * hand-typed from the journal on Wednesday. It lands as a FREE cast in the gu
 * book's marks (lib/gumarks), the envelope /gu already writes, and reads there
 * as `unsealed` until the check-in folds it into the seal.
 *
 * The same seal → PUT → retry-once dance as /gu's own marks, inline like the
 * now verb's store. It never reconciles: that needs the sealed document, which
 * the palette doesn't open — and reconciling against nothing would retire every
 * mark in the book. /gu retires what the seal caught up with the next time it
 * opens.
 */
function CastRow({
  action,
  onDone,
  onStage,
}: {
  action: Extract<QuickLogAction, { kind: "cast" }>;
  onDone: () => void;
  onStage: StageLog;
}) {
  const vault = useVault(false);
  const { openItem, sealItem } = vault;
  const unlocked = vault.status === "unlocked";
  const [cfg, setCfg] = useState<GuMarksConfig | null>(null);
  const [existed, setExisted] = useState(false);
  const [dataErr, setDataErr] = useState(false);

  const fetchMarks = useCallback(async (): Promise<{
    cfg: GuMarksConfig;
    existed: boolean;
  }> => {
    const res = await fetch("/api/gu-marks");
    if (res.status === 404) return { cfg: EMPTY_GU_MARKS, existed: false };
    if (res.status !== 200) throw new Error(`gu-marks: ${res.status}`);
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      GU_MARKS_CONTEXT,
    );
    const parsed = normalizeGuMarks(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (!parsed) throw new Error("gu-marks: bad shape");
    return { cfg: parsed, existed: true };
  }, [openItem]);

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchMarks();
        if (cancelled) return;
        setCfg(loaded.cfg);
        setExisted(loaded.existed);
      } catch {
        if (!cancelled) setDataErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, fetchMarks]);

  async function put(
    base: GuMarksConfig,
    overwrite: boolean,
  ): Promise<GuMarksConfig | "conflict" | null> {
    const next = withFreeCast(base, {
      date: action.day,
      name: action.name,
      stones: action.stones,
    });
    // Unchanged means the list is at its cap — a refused write, not a ✓.
    if (next === base) return null;
    const written = { ...next, seq: Math.max(nextSeq(base), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(written));
    const sealed = await sealItem(
      { n: "gu-marks.json", t: "application/json", s: bytes.length },
      bytes,
      GU_MARKS_CONTEXT,
    );
    const res = await fetch("/api/gu-marks", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(overwrite ? { "x-gu-marks-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (!res.ok) return null;
    rememberSavedSeq("gu-marks", written);
    return written;
  }

  const row = useStaged({
    action,
    ready: cfg !== null,
    storeErr: dataErr,
    write: async () => {
      if (!cfg) return false;
      try {
        let r = await put(cfg, existed);
        // The phone and the desk may both have marked something meanwhile.
        if (r === "conflict") r = await put((await fetchMarks()).cfg, true);
        if (r === null || r === "conflict") return false;
        setCfg(r);
        setExisted(true);
        return true;
      } catch {
        return false;
      }
    },
    onDone,
    onStage,
  });
  return <ActionRow {...row} />;
}

type Phase = "ready" | "saving" | "saved" | "failed";

interface RowText {
  label: string;
  hint: string;
  tone: string;
  onSelect?: () => void;
}

/**
 * The staged row's small state machine, shared by both verbs: publish ↵'s
 * handle upward, run the write once, hold the ✓ for a beat, then close. The
 * store is still being fetched for the first moment the row is on screen, so
 * ↵ reads `…` and does nothing until there is something to write against —
 * a dropped keystroke is kinder than a "could not save" that only meant "not
 * yet".
 */
function useStaged({
  action,
  ready,
  storeErr,
  write,
  onDone,
  onStage,
}: {
  action: QuickLogAction;
  ready: boolean;
  storeErr: boolean;
  write: () => Promise<boolean>;
  onDone: () => void;
  onStage: StageLog;
}): RowText {
  const [phase, setPhase] = useState<Phase>("ready");

  // A corrected figure is a fresh attempt — a ✓ or a failure belongs to the
  // value that produced it, never to the one typed after it.
  const key = quickLogLabel(action);
  const [stagedFor, setStagedFor] = useState(key);
  if (stagedFor !== key) {
    setStagedFor(key);
    setPhase("ready");
  }

  const fire = useCallback(async () => {
    setPhase("saving");
    const ok = await write();
    setPhase(ok ? "saved" : "failed");
  }, [write]);

  // `write` is a fresh closure every render (the store hooks hand back new
  // functions), so what goes UP is a stable wrapper over the latest one: the
  // palette then only hears from the section when ↵ appears or goes away,
  // rather than on every keystroke it causes.
  const latest = useRef(fire);
  useEffect(() => {
    latest.current = fire;
  });
  const enter = useCallback(() => void latest.current(), []);

  const armed = phase === "ready" || phase === "failed";
  const canFire = armed && ready;
  useEffect(() => {
    onStage(true, canFire ? enter : null);
  }, [canFire, enter, onStage]);

  useEffect(() => {
    if (phase !== "saved") return;
    const t = setTimeout(onDone, SAVED_MS);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  if (phase === "saved") {
    return { label: quickLogSaved(action), hint: "closes", tone: "text-up" };
  }
  // An unreachable or unreadable store is the same answer as a refused write:
  // the line is not logged, and the palette stays open to try again.
  if (phase === "failed" || (armed && storeErr)) {
    return {
      label: "could not save — try again",
      hint: "↵",
      tone: "text-muted",
      onSelect: canFire ? enter : undefined,
    };
  }
  return {
    label: quickLogLabel(action),
    hint: canFire ? "↵" : "…",
    tone: canFire ? "bg-amber/10 text-amber" : "text-fg",
    onSelect: canFire ? enter : undefined,
  };
}

/** The section's one row when a verb is staged — the palette's row, in the
 *  palette's shape, standing where the jump list was. */
function ActionRow({ label, hint, tone, onSelect }: RowText) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={!onSelect}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${tone}`}
      >
        <span className="truncate">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
      </button>
    </li>
  );
}
