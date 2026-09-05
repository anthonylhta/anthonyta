import type { ApertureCast, ApertureRefinement } from "./aperture";
import { isValidSeq } from "./seqrule";

/**
 * gumarks — the gu book's marks: the owner's own word about an entry, recorded
 * from /gu the moment it happens and folded into the seal by the check-in
 * (ADR 0175). Two marks exist, both on a consumable or any entry of the book:
 *
 *   - `since` — active effort began: first material in hand and the plan to
 *     finish (the entry's own test line). The row reads "refining · since".
 *   - `cast`  — the consumable was used up, on a day, for some stones. The
 *     entry leaves the book on the site at once and joins the month's casts
 *     under the meter, tagged unsealed until Wednesday confirms.
 *
 * THE SEAL STAYS AUTHORITATIVE. A mark is a log, not a ruling — the check-in
 * reads it, writes `since` onto the entry or a cast into `consumables.casts[]`,
 * and drops the entry; `reconcile` then retires the mark by itself the next
 * time the page opens, so nothing here needs clearing by hand. A false start
 * is cleared by a second tap before the seal, or by the check-in's word after.
 *
 * Keyed by the entry's NAME — the book has no ids, and the check-in already
 * treats the name as the identity it edits by.
 */

export const GU_MARKS_MAX_BYTES = 65_536;
/** Marks keyed by name; a book is capped at 200 and each name is short. */
export const MAX_MARKS = 400;

export interface GuCastMark {
  /** The day it was cast, `YYYY-MM-DD`. */
  date: string;
  /** What it cost, in cents. Absent = nothing typed (a free cast is real). */
  stones?: number;
}

export interface GuMark {
  since?: string;
  cast?: GuCastMark;
}

export interface GuMarksConfig {
  v: 1;
  /** The sealed write counter (ADR 0108's 58b) — see lib/seqrule. */
  seq?: number;
  marks: Record<string, GuMark>;
}

export const EMPTY_GU_MARKS: GuMarksConfig = { v: 1, marks: {} };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 200;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isDay(x: unknown): x is string {
  return (
    typeof x === "string" && DAY_RE.test(x) && !Number.isNaN(Date.parse(x))
  );
}
function isStones(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 1e9;
}

function normMark(x: unknown): GuMark | null {
  if (!isObj(x)) return null;
  const { since, cast } = x;
  if (since !== undefined && !isDay(since)) return null;
  let castOut: GuCastMark | undefined;
  if (cast !== undefined) {
    if (!isObj(cast) || !isDay(cast.date)) return null;
    if (cast.stones !== undefined && !isStones(cast.stones)) return null;
    castOut = {
      date: cast.date,
      ...(cast.stones !== undefined ? { stones: cast.stones } : {}),
    };
  }
  // A mark with nothing in it is malformed rather than a blank — the record
  // keeps only marks that say something.
  if (since === undefined && castOut === undefined) return null;
  return {
    ...(since !== undefined ? { since } : {}),
    ...(castOut !== undefined ? { cast: castOut } : {}),
  };
}

/** The whole record → a config, or null when the FRAME is wrong. Strict: one
 *  bad mark rejects the record, the way every sealed config here rejects. */
export function normalizeGuMarks(x: unknown): GuMarksConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!isValidSeq(x.seq)) return null;
  if (!isObj(x.marks)) return null;
  const names = Object.keys(x.marks);
  if (names.length > MAX_MARKS) return null;
  const marks: Record<string, GuMark> = {};
  for (const name of names) {
    if (name.length === 0 || name.length > MAX_NAME) return null;
    const m = normMark(x.marks[name]);
    if (m === null) return null;
    marks[name] = m;
  }
  return {
    v: 1,
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
    marks,
  };
}

// --- transforms (pure; the component seals and PUTs the result) ---------------

/** Begin or clear a refinement. Clearing a mark that only carried `since`
 *  removes it; a mark that also carries a cast keeps the cast. */
export function withSince(
  cfg: GuMarksConfig,
  name: string,
  since: string | null,
): GuMarksConfig {
  const prev = cfg.marks[name] ?? {};
  const next: GuMark = { ...prev };
  if (since === null) delete next.since;
  else next.since = since;
  return replaceMark(cfg, name, next);
}

/** Record or clear a cast. */
export function withCast(
  cfg: GuMarksConfig,
  name: string,
  cast: GuCastMark | null,
): GuMarksConfig {
  const prev = cfg.marks[name] ?? {};
  const next: GuMark = { ...prev };
  if (cast === null) delete next.cast;
  else next.cast = cast;
  return replaceMark(cfg, name, next);
}

function replaceMark(
  cfg: GuMarksConfig,
  name: string,
  mark: GuMark,
): GuMarksConfig {
  const marks = { ...cfg.marks };
  if (mark.since === undefined && mark.cast === undefined) delete marks[name];
  else marks[name] = mark;
  return { ...cfg, marks };
}

/**
 * Retire marks the seal has caught up with: a name no longer in the book (the
 * check-in dropped it — cast folded in, or the entry refined into the held
 * list) loses its whole mark; an entry the seal now dates loses its `since`.
 * Returns the SAME object when nothing changed, so a caller can skip the write.
 */
export function reconcileMarks(
  cfg: GuMarksConfig,
  refining: readonly ApertureRefinement[],
): GuMarksConfig {
  const sealed = new Map(refining.map((r) => [r.name, r]));
  let changed = false;
  const marks: Record<string, GuMark> = {};
  for (const [name, mark] of Object.entries(cfg.marks)) {
    const entry = sealed.get(name);
    if (!entry) {
      changed = true;
      continue;
    }
    if (entry.since !== undefined && mark.since !== undefined) {
      changed = true;
      if (mark.cast !== undefined) marks[name] = { cast: mark.cast };
      continue;
    }
    marks[name] = mark;
  }
  return changed ? { ...cfg, marks } : cfg;
}

/** The unsealed casts, as cast rows the meter can add to the month — typed
 *  with the entry's own type line so the fold reads like a sealed one. */
export function unsealedCasts(
  cfg: GuMarksConfig,
  refining: readonly ApertureRefinement[],
): ApertureCast[] {
  const out: ApertureCast[] = [];
  for (const r of refining) {
    const cast = cfg.marks[r.name]?.cast;
    if (!cast) continue;
    out.push({
      date: cast.date,
      name: r.name,
      ...(cast.stones !== undefined ? { stones: cast.stones } : {}),
      type: r.type,
    });
  }
  return out;
}
