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
