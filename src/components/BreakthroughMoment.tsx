"use client";

import { useEffect, useRef, useState } from "react";
import { essenceOf } from "@/lib/aperture";
import {
  breakthroughReading,
  essenceVarRef,
  readSeen,
  SEEN_KEY,
  type BreakthroughReading,
} from "@/lib/breakthrough";

/**
 * BreakthroughMoment — the sheet's one-time flourish (roadmap 70a). The page after
 * a breakthrough already IS the new rank: the masthead's line, the numeral and the
 * essence the container declares are all server-rendered from the new glance, so
 * there is nothing here to reveal and nothing that could leak. What is missing is
 * the moment itself — the sheet changes colour between two visits and the owner
 * never sees it happen. So the island puts back the essence the last visit ended
 * on, holds a beat, and lets the whole sheet sweep to the one it is already
 * wearing underneath.
 *
 * The sweep is CSS (globals.css): `--essence` is a registered custom property, so
 * the browser interpolates the VARIABLE and every consumer below the container —
 * numeral, brush, chips, strips, seals — crosses together off one transition.
 * This component only lays the old value down, arms the class, and takes both
 * back off again.
 *
 * Once per change, per device, from a localStorage memory of the last-seen pair.
 * A device with no memory yet (first visit, cleared browser) gets NOTHING: with
 * nothing to compare against, any flourish would be invented.
 */

/** How long the old essence is held before the sweep starts — the beat that lets
 *  the eye recognise the colour it left on. */
const HOLD_MS = 650;
/** How far behind the sweep the line follows. Under SWEEP_MS on purpose: it fades
 *  in as the colour settles, not after it has finished. */
const LINE_MS = 900;
/** The sweep's own length, mirrored from the CSS transition. The class comes off
 *  after it — taking it off early would snap the colour mid-flight. */
const SWEEP_MS = 1400;

/** Everything the flourish needs, decided once from storage. */
interface Moment {
  reading: BreakthroughReading;
  /** The essence being left behind, as the CSS the sweep starts at. */
  fromVar: string;
}

/** Best-effort: a full or blocked store only means the next visit decides again. */
function remember(rank: number, stage: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ rank, stage }));
  } catch {
    // nothing to do — the memory is a convenience, never a source of truth
  }
}

/**
 * Read the memory, decide, and only then write it — in that order, so a second
 * run can never find its own write and conclude nothing happened. Null means
 * "show nothing", which covers a device with no memory, a pair that hasn't moved,
 * and a rank at either end that the canon gave no colour.
 */
function decide(rank: number, stage: string): Moment | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SEEN_KEY);
  } catch {
    // Storage blocked outright: no memory to compare against and none to write.
    return null;
  }
  const seen = readSeen(raw);
  if (seen !== null && seen.rank === rank && seen.stage === stage) return null;

  remember(rank, stage);
  if (seen === null) return null;

  const reading = breakthroughReading(seen.rank, seen.stage, rank, stage);
  if (reading === null) return null;
  const fromName = essenceOf(seen.rank, seen.stage);
  const fromVar = fromName === null ? null : essenceVarRef(fromName);
  return fromVar === null ? null : { reading, fromVar };
}

export function BreakthroughMoment({
  rank,
  stage,
}: {
  rank: number;
  stage: string;
}) {
  const [reading, setReading] = useState<BreakthroughReading | null>(null);
  // The decision is cached against the pair it was made for: a re-run (React's
  // development double-invoke, or a remount) replays the flourish, it does not
  // decide again — deciding again would read the write the first run just made.
  const decided = useRef<{ key: string; moment: Moment | null } | null>(null);

  useEffect(() => {
    const key = `${rank}/${stage}`;
    if (decided.current?.key !== key)
      decided.current = { key, moment: decide(rank, stage) };
    const moment = decided.current.moment;
    if (moment === null) return;

    const sheet = document.querySelector<HTMLElement>(
      'main[data-skin="cultivation"]',
    );
    // No skinned container to sweep — say nothing rather than show a line about a
    // colour change the page never made.
    if (sheet === null) return;

    sheet.style.setProperty("--essence", moment.fromVar);
    // A transition can only start from a value the browser has already computed.
    sheet.getBoundingClientRect();

    const timers = [
      window.setTimeout(() => {
        sheet.classList.add("skin-sweeping");
        // Dropping the override hands the variable back to the class the server
        // rendered — the new essence — and the armed transition makes that a sweep.
        sheet.style.removeProperty("--essence");
      }, HOLD_MS),
      window.setTimeout(() => setReading(moment.reading), HOLD_MS + LINE_MS),
      window.setTimeout(
        () => sheet.classList.remove("skin-sweeping"),
        HOLD_MS + SWEEP_MS,
      ),
    ];

    return () => {
      for (const t of timers) window.clearTimeout(t);
      sheet.style.removeProperty("--essence");
      sheet.classList.remove("skin-sweeping");
    };
  }, [rank, stage]);

  if (reading === null) return null;

  return (
    <p className="skin-breakline mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-(--essence)">
      {/* the cinnabar half of the line — the same fixed red as the sheet's seals,
          and aria-hidden because the word beside it says it in English */}
      <span
        aria-hidden
        lang="zh"
        className="font-[family-name:var(--font-zh)] text-cinnabar"
      >
        突破
      </span>
      <span>breakthrough</span>
      <span className="text-muted/60">{reading.from}</span>
      <span className="text-muted">→</span>
      <span>{reading.to}</span>
    </p>
  );
}
