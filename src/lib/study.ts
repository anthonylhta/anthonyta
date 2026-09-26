import { isValidSeq } from "./seqrule";

/**
 * study — the Japanese study log: one row per sitting, a day and a source, with
 * the minutes when they were worth writing down. Written from the reader's
 * japan lane and the palette's `ja` verb, read by the check-in's counters, the
 * vocabulary gu's clock and the dao band's live week.
 *
 * A DAY IS A DAY. Everything that reads this log counts distinct days, never
 * rows or minutes: two articles and an Anki run on a Thursday are one study
 * day, exactly as the seal has always counted them from the owner's word. The
 * rows keep the detail so a later reading can use it; nothing here ranks it.
 *
 * Sealed under the vault master key at `meta/study` (the circle pattern); the
 * server only ever holds ciphertext.
 */

export const STUDY_MAX_BYTES = 65_536;
/** Years of daily sittings, several a day — an envelope guard, not a pace. */
export const MAX_STUDY_ENTRIES = 2000;
export const MAX_STUDY_SOURCE = 200;
/** Ten hours in one row is a typo, not a sitting. */
export const MAX_STUDY_MINUTES = 600;

export interface StudyEntry {
  /** The Sydney day it was studied, `YYYY-MM-DD`. */
  date: string;
  /** What was studied — a headline, a deck, a book. */
  source: string;
  minutes?: number;
}

export interface StudyConfig {
  v: 1;
  /** The sealed write counter (ADR 0108's 58b) — see lib/seqrule. */
  seq?: number;
  /** Oldest first, by day then by the order they were logged. */
  entries: StudyEntry[];
}

export const EMPTY_STUDY: StudyConfig = { v: 1, entries: [] };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isDay(x: unknown): x is string {
  return (
    typeof x === "string" && DAY_RE.test(x) && !Number.isNaN(Date.parse(x))
  );
}

function normEntry(x: unknown): StudyEntry | null {
  if (!isObj(x) || !isDay(x.date) || typeof x.source !== "string") return null;
  const source = x.source.trim();
  if (source.length === 0 || source.length > MAX_STUDY_SOURCE) return null;
  const { minutes } = x;
  if (minutes !== undefined) {
    if (
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > MAX_STUDY_MINUTES
    )
      return null;
    return { date: x.date, source, minutes };
  }
  return { date: x.date, source };
}

/** The whole record → a config, or null when the FRAME is wrong. Strict: one
 *  bad row rejects the record, the way every sealed config here rejects. */
export function normalizeStudy(x: unknown): StudyConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!isValidSeq(x.seq)) return null;
  if (!Array.isArray(x.entries) || x.entries.length > MAX_STUDY_ENTRIES)
    return null;
  const entries: StudyEntry[] = [];
  for (const row of x.entries) {
    const entry = normEntry(row);
    if (entry === null) return null;
    entries.push(entry);
  }
  // A stable sort: same-day rows keep the order they were logged in.
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return {
    v: 1,
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
    entries,
  };
}

// --- transforms (pure; the hook seals and PUTs the result) --------------------

/**
 * Log one sitting, in day order — after every row of its own day, so a
 * back-dated line lands where it belongs and a same-day one lands last. Returns
 * the config UNCHANGED when the row is malformed or the log is full, so the
 * caller reports a refused write rather than a ✓ over nothing.
 */
export function addStudy(cfg: StudyConfig, entry: StudyEntry): StudyConfig {
  const norm = normEntry(entry);
  if (norm === null || cfg.entries.length >= MAX_STUDY_ENTRIES) return cfg;
  let at = cfg.entries.length;
  while (at > 0 && cfg.entries[at - 1].date > norm.date) at--;
  const entries = [...cfg.entries];
  entries.splice(at, 0, norm);
  return { ...cfg, entries };
}

/** The newest day studied — the vocabulary gu's clock — or null for none. */
export function lastStudyDay(cfg: StudyConfig): string | null {
  return cfg.entries.at(-1)?.date ?? null;
}

/** Distinct days studied, ever. */
export function studyDays(cfg: StudyConfig): number {
  return new Set(cfg.entries.map((e) => e.date)).size;
}

/** The distinct days studied inside a window, oldest first — the check-in's
 *  Japanese line. */
export function studyDaysIn(
  cfg: StudyConfig,
  window: { from: string; to: string },
): string[] {
  return [
    ...new Set(
      cfg.entries
        .map((e) => e.date)
        .filter((d) => d >= window.from && d <= window.to),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** The calendar day before `ymd` — UTC-midnight math, so a DST shift never
 *  eats or repeats a day. */
function prevDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Sittings per day over the trailing `days` days ending at `today`, oldest →
 * newest — the dao band's strip, shaped like the meal log's protein series so
 * the band reads it the same way (a nonzero day is a day that left evidence).
 */
export function studyDaysTrailing(
  cfg: StudyConfig,
  today: string,
  days = 7,
): number[] {
  const window: string[] = [];
  let cursor = today;
  for (let i = 0; i < days; i++) {
    window.push(cursor);
    cursor = prevDay(cursor);
  }
  window.reverse();
  const counts = new Map<string, number>();
  for (const e of cfg.entries)
    counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
  return window.map((d) => counts.get(d) ?? 0);
}
