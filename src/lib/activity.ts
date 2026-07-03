import { contribLevel } from "./github";

/**
 * Pure helpers for the command center's "this week" activity strips (ADR 0044):
 * turn each domain's raw daily activity into a trailing window of 0–4 levels the
 * <ActivityStrip> renders. No `next` import, so it's unit-tested on its own.
 */

/** How many trailing days each strip covers (10 weeks). */
export const ACTIVITY_DAYS = 70;

/** The calendar day before `ymd` (UTC-midnight math, DST-safe). */
function prevDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** A length-`days` array of per-day values ending at `today`, oldest → newest. */
function windowSeries(
  perDay: Map<string, number>,
  days: number,
  today: string,
): number[] {
  const out: number[] = [];
  let cursor = today;
  for (let i = 0; i < days; i++) {
    out.push(perDay.get(cursor) ?? 0);
    cursor = prevDay(cursor);
  }
  return out.reverse();
}

/** Bucket a daily-count series to GitHub-style 0–4 levels, scaled to its busiest day. */
export function toLevels(counts: number[]): number[] {
  const max = Math.max(1, ...counts);
  return counts.map((c) => contribLevel(c, max));
}

// en-CA formats as YYYY-MM-DD. Hoisted — Intl formatters are costly to build.
const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
});

/** Count items per day over the trailing window — `isoDates` are each item's
 *  timestamp, bucketed on its Sydney calendar day (the `today` anchor is a Sydney
 *  day, so a UTC-evening timestamp belongs to the next day). For notes etc. */
export function dailyCounts(
  isoDates: string[],
  days: number,
  today: string,
): number[] {
  const perDay = new Map<string, number>();
  for (const iso of isoDates) {
    const day = SYDNEY_DAY.format(new Date(iso));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return windowSeries(perDay, days, today);
}

/** Per-day deltas of a CUMULATIVE series (e.g. total reading chapters), placed on
 *  the later day of each consecutive pair — for sources that record running totals
 *  (the snapshot store), not events. Negative diffs clamp to 0. */
export function dailyDeltas(
  series: { date: string; value: number }[],
  days: number,
  today: string,
): number[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const perDay = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const delta = Math.max(0, sorted[i].value - sorted[i - 1].value);
    perDay.set(sorted[i].date, (perDay.get(sorted[i].date) ?? 0) + delta);
  }
  return windowSeries(perDay, days, today);
}
