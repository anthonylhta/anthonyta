/**
 * sleep — the pure spine of the nightly sleep log (the /aperture vessel's rest
 * figure).
 *
 * A sibling of `steps`, and deliberately the same plaintext class: a night's
 * duration is low-sensitivity — closer to the weather than to net worth — so it
 * rides a plain JSON blob the phone POSTs to, NOT the E2EE envelope. That choice
 * buys a figure the vessel can print with no unlock gate; the E2EE boundary still
 * holds for everything that matters (finances, notes, messages).
 *
 * The phone is the single writer: a nightly automation POSTs `{ minutes, date? }`
 * to /api/daily/sleep, which upserts one night into the retained history map.
 * Everything here is pure so the route + connector stay thin and the
 * parse/validation is unit-pinned.
 */

/** A YYYY-MM-DD (the Sydney day the owner WOKE) → minutes-asleep history. */
export interface SleepData {
  nights: Record<string, number>;
}

/** Body cap for the ingest POST — a tiny JSON object, nothing more. */
export const MAX_SLEEP_BYTES = 1024;

/** Nights of history retained on write (a rolling ~quarter, matching steps). */
export const SLEEP_HISTORY_CAP = 120;

/** A night can't exceed a day — guards against garbage / overflow input. */
const MAX_NIGHT_MINUTES = 1440;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SleepIngest {
  minutes: number;
  /** Optional Sydney waking day; the route defaults to today when absent. */
  date?: string;
}

function isValidMinutes(x: unknown): x is number {
  return (
    typeof x === "number" &&
    Number.isInteger(x) &&
    x >= 0 &&
    x <= MAX_NIGHT_MINUTES
  );
}

/** Validate an ingest body: `{ minutes: int 0..1440, date?: YYYY-MM-DD }`. */
export function isSleepIngest(x: unknown): x is SleepIngest {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (!isValidMinutes(o.minutes)) return false;
  if (
    o.date !== undefined &&
    (typeof o.date !== "string" || !DATE_RE.test(o.date))
  )
    return false;
  return true;
}

/** Parse the stored JSON into a clean history — bad entries dropped, never throws.
 *  Reads `.nights` regardless of a `v` field, so a versioned or bare blob both work. */
export function parseSleepStore(json: string): SleepData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { nights: {} };
  }
  if (typeof raw !== "object" || raw === null) return { nights: {} };
  const nightsIn = (raw as Record<string, unknown>).nights;
  if (typeof nightsIn !== "object" || nightsIn === null) return { nights: {} };
  const nights: Record<string, number> = {};
  for (const [date, minutes] of Object.entries(
    nightsIn as Record<string, unknown>,
  )) {
    if (DATE_RE.test(date) && isValidMinutes(minutes)) nights[date] = minutes;
  }
  return { nights };
}

/** Serialize for storage (a stable, versioned shape). */
export function serializeSleepStore(data: SleepData): string {
  return JSON.stringify({ v: 1, nights: data.nights });
}

/**
 * Upsert one night's minutes and prune to the most recent `cap` nights. The phone
 * is the single writer, so last-write-wins on a given night is exactly right — a
 * re-post overwrites an earlier partial reading (a nap logged before the phone had
 * the whole night). ISO dates sort lexicographically = chronologically, so the
 * newest `cap` are simply the tail of the sorted keys.
 */
export function upsertNight(
  data: SleepData,
  date: string,
  minutes: number,
  cap = SLEEP_HISTORY_CAP,
): SleepData {
  const merged = { ...data.nights, [date]: minutes };
  const kept = Object.keys(merged).sort().slice(-cap);
  const nights: Record<string, number> = {};
  for (const d of kept) nights[d] = merged[d];
  return { nights };
}

/** A night's minutes, or null when nothing has been recorded for `day`. */
export function sleepForNight(data: SleepData, day: string): number | null {
  return Object.prototype.hasOwnProperty.call(data.nights, day)
    ? data.nights[day]
    : null;
}

/** The calendar day before `ymd` (UTC-midnight math, DST-safe — mirrors activity.ts). */
function prevDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The mean minutes asleep over the last 7 calendar days ending at `today`
 * (inclusive), across the nights that actually HAVE a record — null when none of
 * them do.
 *
 * Recorded nights only: a missing night is a night the phone never posted, not a
 * night nobody slept, so averaging the gaps in as zeroes would print a rest the
 * body never lost. Rounded, because the vessel reads the figure in hours anyway.
 */
export function weekAverage(data: SleepData, todayISO: string): number | null {
  let sum = 0;
  let logged = 0;
  let cursor = todayISO;
  for (let i = 0; i < 7; i++) {
    const minutes = sleepForNight(data, cursor);
    if (minutes !== null) {
      sum += minutes;
      logged += 1;
    }
    cursor = prevDay(cursor);
  }
  return logged === 0 ? null : Math.round(sum / logged);
}

/**
 * Weekly averages, oldest → newest — the vessel's rest strip. Each value is one
 * 7-day window, stepping back a week at a time from `todayISO`, which is the
 * anchoring the bodyweight strip beside it already uses: rolling sevens off
 * today, not calendar weeks. The two pictures have to line up week for week, or
 * reading one against the other says nothing.
 *
 * A week the phone posted nothing for is `null` rather than a zero — the
 * recorded-nights rule of `weekAverage`, carried up a level: a week of no data
 * is not a week of no sleep. The caller decides what a gap looks like; this
 * function will not invent a night either way.
 */
export function weeklyAverages(
  data: SleepData,
  todayISO: string,
  weeks = 10,
): (number | null)[] {
  const out: (number | null)[] = [];
  let cursor = todayISO;
  for (let k = 0; k < weeks; k++) {
    out.push(weekAverage(data, cursor));
    for (let i = 0; i < 7; i++) cursor = prevDay(cursor);
  }
  return out.reverse();
}

/**
 * A ~2-week placeholder ending at `today`, for when the store is entirely OFF
 * (no R2 — local dev, CI) so the vessel looks alive. Deterministic (a fixed
 * pattern of plausible nights), so screenshots + tests stay stable. NOT used for
 * an ABSENT store (R2 on, nothing posted yet) — that renders the honest empty
 * state, since a fabricated night on the real reading would be dishonest.
 */
export function sampleSleep(today: string): SleepData {
  const pattern = [
    430, 465, 390, 505, 445, 380, 520, 470, 415, 495, 360, 450, 485, 425,
  ];
  const nights: Record<string, number> = {};
  const base = new Date(`${today}T00:00:00Z`);
  pattern.forEach((v, i) => {
    const offset = pattern.length - 1 - i; // last element lands on `today`
    const d = new Date(base.getTime() - offset * 86_400_000);
    nights[d.toISOString().slice(0, 10)] = v;
  });
  return { nights };
}
