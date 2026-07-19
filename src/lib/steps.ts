/**
 * steps — the pure spine of the daily step-count row (the command center's TODAY
 * zone, ADR 0032).
 *
 * This is the hub's FIRST plaintext personal-data store, deliberately (the owner's
 * call): a step count is low-sensitivity — closer to the weather than to net worth
 * — so it rides a plain JSON blob the phone POSTs to, NOT the E2EE envelope. That
 * choice buys an always-visible ambient row (no unlock gate); the E2EE boundary
 * still holds for everything that matters (finances, notes, messages).
 *
 * The phone is the single writer: Samsung Health → Android Health Connect → a daily
 * automation POSTs `{ steps, date? }` to /api/daily/steps, which upserts one day
 * into the retained history map. Everything here is pure so the route + connector
 * stay thin and the parse/validation is unit-pinned.
 */

/** A YYYY-MM-DD (Sydney) → step-count history. */
export interface StepsData {
  days: Record<string, number>;
}

/** Body cap for the ingest POST — a tiny JSON object, nothing more. */
export const MAX_STEPS_BYTES = 1024;

/** Days of history retained on write (a rolling ~quarter — plenty for a strip). */
export const STEPS_HISTORY_CAP = 120;

/** How many trailing days the TODAY-row strip covers. */
export const STEPS_STRIP_DAYS = 14;

/** A daily ceiling no human clears — guards against garbage / overflow input. */
const MAX_DAILY_STEPS = 300_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StepsIngest {
  steps: number;
  /** Optional Sydney calendar day; the route defaults to today when absent. */
  date?: string;
}

function isValidCount(x: unknown): x is number {
  return (
    typeof x === "number" &&
    Number.isInteger(x) &&
    x >= 0 &&
    x <= MAX_DAILY_STEPS
  );
}

/** Validate an ingest body: `{ steps: int 0..MAX, date?: YYYY-MM-DD }`. */
export function isStepsIngest(x: unknown): x is StepsIngest {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (!isValidCount(o.steps)) return false;
  if (
    o.date !== undefined &&
    (typeof o.date !== "string" || !DATE_RE.test(o.date))
  )
    return false;
  return true;
}

/** Parse the stored JSON into a clean history — bad entries dropped, never throws.
 *  Reads `.days` regardless of a `v` field, so a versioned or bare blob both work. */
export function parseStepsStore(json: string): StepsData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { days: {} };
  }
  if (typeof raw !== "object" || raw === null) return { days: {} };
  const daysIn = (raw as Record<string, unknown>).days;
  if (typeof daysIn !== "object" || daysIn === null) return { days: {} };
  const days: Record<string, number> = {};
  for (const [date, count] of Object.entries(
    daysIn as Record<string, unknown>,
  )) {
    if (DATE_RE.test(date) && isValidCount(count)) days[date] = count;
  }
  return { days };
}

/** Serialize for storage (a stable, versioned shape). */
export function serializeStepsStore(data: StepsData): string {
  return JSON.stringify({ v: 1, days: data.days });
}

/**
 * Upsert one day's count and prune to the most recent `cap` days. The phone is the
 * single writer, so last-write-wins on a given day is exactly right — a re-post of
 * today overwrites the earlier partial count. ISO dates sort lexicographically =
 * chronologically, so the newest `cap` are simply the tail of the sorted keys.
 */
export function upsertDay(
  data: StepsData,
  date: string,
  steps: number,
  cap = STEPS_HISTORY_CAP,
): StepsData {
  const merged = { ...data.days, [date]: steps };
  const kept = Object.keys(merged).sort().slice(-cap);
  const days: Record<string, number> = {};
  for (const d of kept) days[d] = merged[d];
  return { days };
}

/** Today's count, or null when nothing has been recorded for `day`. */
export function stepsForDay(data: StepsData, day: string): number | null {
  return Object.prototype.hasOwnProperty.call(data.days, day)
    ? data.days[day]
    : null;
}

/** The calendar day before `ymd` (UTC-midnight math, DST-safe — mirrors activity.ts). */
function prevDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The last `n` calendar days ending at `today` (inclusive) as a count series,
 * oldest → newest; missing days are 0. Feeds the trailing strip.
 */
export function trailingSeries(
  data: StepsData,
  n: number,
  today: string,
): number[] {
  const out: number[] = [];
  let cursor = today;
  for (let i = 0; i < n; i++) {
    out.push(data.days[cursor] ?? 0);
    cursor = prevDay(cursor);
  }
  return out.reverse();
}

/** Comma-group a non-negative integer: 6240 → "6,240". Deterministic (SSR-safe). */
export function commas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A ~2-week placeholder ending at `today`, for when the store is entirely OFF
 * (no R2 — local dev, CI) so the dashboard looks alive. Deterministic (a fixed
 * weekly rhythm), so screenshots + tests stay stable. NOT used for an ABSENT store
 * (R2 on, nothing posted yet) — that renders the honest empty state, since fake
 * counts on the real dashboard would be dishonest.
 */
export function sampleSteps(today: string): StepsData {
  const pattern = [
    8200, 10400, 6100, 12500, 9300, 4200, 15800, 7600, 11200, 5400, 9900, 8800,
    13100, 7000,
  ];
  const days: Record<string, number> = {};
  const base = new Date(`${today}T00:00:00Z`);
  pattern.forEach((v, i) => {
    const offset = pattern.length - 1 - i; // last element lands on `today`
    const d = new Date(base.getTime() - offset * 86_400_000);
    days[d.toISOString().slice(0, 10)] = v;
  });
  return { days };
}
