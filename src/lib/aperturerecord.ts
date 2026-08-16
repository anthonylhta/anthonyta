import { essenceOf, type ApertureDoc } from "./aperture";
import { diffChanges } from "./aperturesync";

/**
 * aperturerecord — the pure spine of the sheet's "the record" band: the archived
 * seal history (`meta/aperture-hist/*`, ADR 0116) turned into rows. The same
 * bargain as every aperture module: THE SITE RENDERS, NEVER ADJUDICATES — a row
 * repeats what a past check-in sealed, and the delta between two rows is the
 * sync script's own diff vocabulary (`diffChanges`), not a judgment made here.
 *
 * Pure and env-less: no store, no fetch, no clock. The client island does the
 * IO (list → fetch → decrypt) and hands the decrypted documents in; everything
 * decidable lands here where vitest reaches it.
 */

/**
 * How many archived seals the band fetches — and therefore decrypts — per load.
 * Weekly seals make this about a quarter of history on screen; everything older
 * is a count ("+n earlier"), not a request. The cap is the whole reason the
 * band's cost stays flat as years accrue.
 */
export const RECORD_FETCH_CAP = 12;

/** A day exactly as the dated keys spell it. Kept in step with the aevcontext
 *  family shape by test (`apertureHistPath` round-trip), not by import — the
 *  wire hands bare days, not keys. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What the band should fetch, and how much history it is NOT showing. */
export interface RecordPlan {
  /** Days to fetch, newest first, at most `RECORD_FETCH_CAP`. */
  fetch: string[];
  /** Well-formed days beyond the cap — rendered as a count, never fetched. */
  older: number;
}

/**
 * The wire listing → a fetch plan. The input is `unknown` on purpose: the
 * listing crosses the network, so it is trusted no further than its shape —
 * anything but an array of well-formed days is dropped row by row, and a wholly
 * malformed listing plans nothing rather than throwing inside the island.
 */
export function planRecordFetch(listing: unknown): RecordPlan {
  if (!Array.isArray(listing)) return { fetch: [], older: 0 };
  const days = [
    ...new Set(
      listing.filter(
        (d): d is string => typeof d === "string" && DAY_RE.test(d),
      ),
    ),
  ];
  days.sort((a, b) => b.localeCompare(a));
  return {
    fetch: days.slice(0, RECORD_FETCH_CAP),
    older: Math.max(0, days.length - RECORD_FETCH_CAP),
  };
}

/** One archived seal as the band draws it. */
export interface RecordRow {
  day: string;
  rank: number;
  stage: string;
  /** Canon essence name, or null for a rank/stage this build has no entry for
   *  (rendered by omission, exactly like an unknown vocabulary value). */
  essence: string | null;
  /** What moved since the seal BELOW it in the list — `diffChanges` joined the
   *  way the sync prints them — or null on the oldest fetched row and on a week
   *  where nothing in diff scope moved. Rank movement carries no segment: the
   *  adjacent rows already show it. */
  delta: string | null;
}

/**
 * Decrypted entries → rows, newest first. Order is imposed here rather than
 * trusted from the caller: the fetches resolve in any order, and a mis-sorted
 * record would pin every delta to the wrong neighbour.
 */
export function recordRows(
  entries: { day: string; doc: ApertureDoc }[],
): RecordRow[] {
  const sorted = [...entries].sort((a, b) => b.day.localeCompare(a.day));
  return sorted.map((e, i) => {
    const older = sorted[i + 1];
    const changes = older === undefined ? [] : diffChanges(older.doc, e.doc);
    return {
      day: e.day,
      rank: e.doc.public.rank,
      stage: e.doc.public.stage,
      essence: essenceOf(e.doc.public.rank, e.doc.public.stage),
      delta: changes.length > 0 ? changes.join(" · ") : null,
    };
  });
}

/** One streak read across the seals it appears in — the week-over-week strip the
 *  record was kept for. */
export interface RecordTrend {
  name: string;
  /** Counts oldest → newest, one per seal that CARRIED this streak. A seal from
   *  before the streak existed contributes nothing rather than a zero: padding
   *  would draw a climb out of thin air. */
  values: number[];
  first: number;
  last: number;
  /** The NEWEST seal's target, or null when the newest seal no longer tracks the
   *  streak — a target retired weeks ago is not the one to read a strip against. */
  target: number | null;
}

/**
 * Decrypted entries → one trend per streak, OLDEST first inside each strip: a
 * sparkline reads left to right in time, the opposite of the rows above it.
 *
 * The names are data (an open record, the same bargain as `streakChanges`), so
 * the vocabulary is whatever the seals carry — union across every fetched seal,
 * in first-seen order walking oldest → newest, and `Object.hasOwn` throughout so
 * a streak named `toString` diffs against the seals rather than Object.prototype.
 * A streak seen only once is dropped: one point is a reading, not a trend.
 */
export function recordTrends(
  entries: { day: string; doc: ApertureDoc }[],
): RecordTrend[] {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const newest = sorted[sorted.length - 1];

  const names: string[] = [];
  for (const e of sorted)
    for (const name of Object.keys(e.doc.sealed.streaks))
      if (!names.includes(name)) names.push(name);

  const trends: RecordTrend[] = [];
  for (const name of names) {
    const values: number[] = [];
    for (const e of sorted)
      if (Object.hasOwn(e.doc.sealed.streaks, name))
        values.push(e.doc.sealed.streaks[name].count);
    if (values.length < 2) continue;
    trends.push({
      name,
      values,
      first: values[0],
      last: values[values.length - 1],
      target: Object.hasOwn(newest.doc.sealed.streaks, name)
        ? newest.doc.sealed.streaks[name].target
        : null,
    });
  }
  return trends;
}
