/**
 * Pure riichi streak + activity transforms — mirrors the riichi app's own
 * `streakFromDays` (its `src/lib/server/streakLogic.ts`) so the hub computes the
 * SAME streak from the same `puzzle_results` rows it reads (ADR 0046). No `next`
 * import, so it's unit-tested on its own; the connector wraps it around the read.
 */

export interface RiichiStats {
  /** trailing daily levels for the pulse strip: 2 = solved, 1 = attempted-wrong, 0 = no attempt */
  activity: number[];
  currentStreak: number;
  bestStreak: number;
  /** today answered correctly */
  todaySolved: boolean;
  /** false when served from SAMPLE (no creds / no user id / read failed) */
  isLive: boolean;
}

/** The calendar day `n` days from `ymd` (UTC-midnight math, DST-safe). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * One user's full per-day history → streak + trailing activity window. `today` is
 * the Sydney calendar day; `days` is the strip length. Streak logic is copied from
 * riichi's `streakFromDays`: a correct day extends the streak, today being unanswered
 * yet doesn't break it.
 */
export function riichiStats(
  rows: { date: string; correct: boolean }[],
  today: string,
  days: number,
): RiichiStats {
  const correctByDate = new Map<string, boolean>();
  for (const r of rows) correctByDate.set(r.date, r.correct);

  // Current: walk back from today (or yesterday, if today isn't answered yet) while
  // each day is correct.
  let current = 0;
  let cursor = correctByDate.has(today) ? today : addDays(today, -1);
  while (correctByDate.get(cursor) === true) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // Best: longest run of contiguous calendar days that are all correct.
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of [...correctByDate.keys()].sort()) {
    const contiguous = prev !== null && addDays(prev, 1) === date;
    run = correctByDate.get(date) ? (contiguous ? run + 1 : 1) : 0;
    if (run > best) best = run;
    prev = date;
  }

  // Trailing window, oldest → newest: solved 2 / attempted-wrong 1 / missed 0.
  const activity: number[] = [];
  let day = today;
  for (let i = 0; i < days; i++) {
    const answered = correctByDate.has(day);
    activity.push(answered ? (correctByDate.get(day) ? 2 : 1) : 0);
    day = addDays(day, -1);
  }
  activity.reverse();

  return {
    activity,
    currentStreak: current,
    bestStreak: best,
    todaySolved: correctByDate.get(today) === true,
    isLive: true,
  };
}

/** Shown when RIICHI_DATABASE_URL / RIICHI_USER_ID isn't set (CI, local) or a read
 *  fails. Not real data — a believable mostly-solved 70-day history. */
export const sampleRiichiStats: RiichiStats = {
  activity: Array.from({ length: 70 }, (_, i) => {
    const s = ((i + 1) * 2654435761) % 97;
    return s % 7 === 0 ? 0 : s % 11 === 0 ? 1 : 2;
  }),
  currentStreak: 6,
  bestStreak: 41,
  todaySolved: false,
  isLive: false,
};
