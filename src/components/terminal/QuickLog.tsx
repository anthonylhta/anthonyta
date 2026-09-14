"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMeals } from "@/components/useMeals";
import { useTodo } from "@/components/useTodo";
import { sydneyToday } from "@/lib/fin";
import { setWeight } from "@/lib/meals";
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
    return action.kind === "weigh" ? (
      <WeighRow action={action} onDone={onDone} onStage={onStage} />
    ) : (
      <CaptureRow action={action} onDone={onDone} onStage={onStage} />
    );
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
        <span className="truncate">w 67.4 · todo …</span>
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
