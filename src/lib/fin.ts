import { parseCmcCsv, type Portfolio } from "./portfolio";

/**
 * Pure helpers + types for the E2EE financial layer (ADR 0054; holdings folded in
 * by ADR 0061) — everything in the fin envelope decrypts on the client, so this
 * layer only ever sees already-plaintext JSON. No `next`, store, or `react` import
 * and no Node-only APIs, so it's safe in a client component and unit-testable on
 * its own (mirrors lib/files, lib/activity).
 *
 * The envelope holds three things, all owner-written from the unlocked panel:
 *   - `entries` — dated cash/HISA balances (a step function, superseding the old
 *     `CASH_AUD`/`HISA_AUD` env vars). No entry on or before a day reads as 0.
 *   - `invested` — dated invested totals, one appended per CSV import (a step
 *     function too: the figure only changes when a new export is uploaded, which
 *     is exactly what the retired nightly sealed boxes were sampling daily).
 *   - `portfolio` — the latest parsed CMC snapshot (holdings + totals), rendered
 *     behind the unlock; the server never parses a CSV again.
 *
 * v1 envelopes (cash only) normalize on read; the first save writes v2.
 */

/** fin-config envelope cap, enforced at the route before decryption. */
export const FIN_MAX_BYTES = 32768;
/** How many days of the plaintext reading index we retain before trimming. */
export const SNAP_INDEX_MAX_DAYS = 400;

/** One dated cash/HISA balance. `date` is a Sydney calendar day, `YYYY-MM-DD`. */
export interface FinEntry {
  date: string;
  cash: number;
  hisa: number;
  rate: number | null;
}
/** One dated invested total, appended at CSV import time. */
export interface InvestedEntry {
  date: string;
  investedCents: number;
}
/** The fin config — both series ascending by date, one row per day. */
export interface FinConfig {
  v: 2;
  entries: FinEntry[];
  invested: InvestedEntry[];
  portfolio: Portfolio | null;
}
/** One day of the (unsealed) reading index — the week-over-week baseline source. */
export interface SnapIndexDay {
  date: string;
  readingChapters: number;
}
/** The reading index — days ascending, one per day, trimmed to the last window. */
export interface SnapIndex {
  v: 1;
  days: SnapIndexDay[];
}
/** One point of the net-worth trend series the `/portfolio` chart draws. */
export interface NetWorthPoint {
  date: string;
  totalCents: number;
}

// en-CA formats as YYYY-MM-DD. Hoisted — Intl formatters are costly to build.
const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
});

/** Add `delta` calendar days to a `YYYY-MM-DD` via UTC-midnight math — DST-safe and
 *  timezone-independent, since it only ever touches the calendar, never a clock. */
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Today's date in Australia/Sydney, `YYYY-MM-DD` — DST-correct via Intl. */
export function sydneyToday(now: Date = new Date()): string {
  return SYDNEY_DAY.format(now);
}

/** The Sydney calendar day exactly `days` days before `now` — reckoned on the
 *  calendar (UTC date math on the Sydney day), so it can't drift across a DST edge. */
export function sydneyDaysAgo(days: number, now: Date = new Date()): string {
  return addDays(sydneyToday(now), -days);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isYmd(x: unknown): x is string {
  return typeof x === "string" && YMD.test(x);
}
/** A finite number ≥ 0 — no NaN, no Infinity, no string coercion. */
function isNonNegNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}
/** A safe integer ≥ 0. */
function isNonNegInt(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** A cash entries array: dated rows, non-negative balances, strictly ascending. */
function isEntries(x: unknown): x is FinEntry[] {
  if (!Array.isArray(x) || x.length > 4000) return false;
  let prev = "";
  for (const e of x) {
    if (!isObj(e)) return false;
    if (!isYmd(e.date) || !isNonNegNum(e.cash) || !isNonNegNum(e.hisa))
      return false;
    if (!(e.rate === null || isNonNegNum(e.rate))) return false;
    if (!(e.date > prev)) return false; // strictly ascending (prev "" first)
    prev = e.date;
  }
  return true;
}

/** An invested series: dated rows, safe-integer cents, strictly ascending. */
function isInvested(x: unknown): x is InvestedEntry[] {
  if (!Array.isArray(x) || x.length > 4000) return false;
  let prev = "";
  for (const e of x) {
    if (!isObj(e)) return false;
    if (!isYmd(e.date) || !isNonNegInt(e.investedCents)) return false;
    if (!(e.date > prev)) return false;
    prev = e.date;
  }
  return true;
}

/** A finite number of either sign (gains and P&L go negative). */
function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** A parsed CMC snapshot: bounded holdings with finite figures, plus totals.
 *  Codes are display strings the panel renders — bounded, never trusted further. */
export function isPortfolioSnapshot(x: unknown): x is Portfolio {
  if (!isObj(x)) return false;
  if (typeof x.asOf !== "string" || x.asOf.length > 100) return false;
  if (!Array.isArray(x.holdings) || x.holdings.length > 500) return false;
  for (const h of x.holdings) {
    if (!isObj(h)) return false;
    if (typeof h.code !== "string" || h.code.length === 0 || h.code.length > 20)
      return false;
    for (const k of [
      "units",
      "last",
      "value",
      "cost",
      "dayGain",
      "pnl",
      "pnlPct",
    ]) {
      if (!isFiniteNum(h[k])) return false;
    }
  }
  const t = x.totals;
  if (!isObj(t)) return false;
  for (const k of ["value", "cost", "dayGain", "pnl", "pnlPct"]) {
    if (!isFiniteNum(t[k])) return false;
  }
  return true;
}

/**
 * Strict runtime guard for a decrypted v2 fin-config. Anything off shape → false;
 * v1 envelopes are handled by `normalizeFinConfig`, not here.
 */
export function isFinConfig(x: unknown): x is FinConfig {
  return (
    isObj(x) &&
    x.v === 2 &&
    isEntries(x.entries) &&
    isInvested(x.invested) &&
    (x.portfolio === null || isPortfolioSnapshot(x.portfolio))
  );
}

/**
 * A decrypted envelope of either vintage → a v2 config, or null when the shape is
 * unrecognizable. v1 (the cash-only era, ADR 0054) carries no invested series and
 * no holdings — both start empty and fill in from the first CSV import. Every
 * caller reads through this; writes always produce v2.
 */
export function normalizeFinConfig(x: unknown): FinConfig | null {
  if (isFinConfig(x)) return x;
  if (isObj(x) && x.v === 1 && isEntries(x.entries)) {
    return { v: 2, entries: x.entries, invested: [], portfolio: null };
  }
  return null;
}

/** Strict guard for the reading index: `v === 1`, a days array of at most 500 (the
 *  trim cap plus slack), each a dated day with a non-negative safe-integer chapter
 *  count, dates strictly ascending. */
export function isSnapIndex(x: unknown): x is SnapIndex {
  if (!isObj(x) || x.v !== 1 || !Array.isArray(x.days)) return false;
  if (x.days.length > 500) return false;
  let prev = "";
  for (const d of x.days) {
    if (!isObj(d)) return false;
    if (!isYmd(d.date) || !isNonNegInt(d.readingChapters)) return false;
    if (!(d.date > prev)) return false;
    prev = d.date;
  }
  return true;
}

/** Insertion index that keeps `dates` ascending — the first slot whose date is
 *  greater than `date`, or the end. */
function insertAt(dates: { date: string }[], date: string): number {
  const i = dates.findIndex((e) => e.date > date);
  return i < 0 ? dates.length : i;
}

/** A new config with `entry` merged into the cash series — replacing a same-day
 *  row, else inserted so the entries stay ascending. Never mutates the input. */
export function upsertEntry(cfg: FinConfig, entry: FinEntry): FinConfig {
  const kept = cfg.entries.filter((e) => e.date !== entry.date);
  const at = insertAt(kept, entry.date);
  return { ...cfg, entries: [...kept.slice(0, at), entry, ...kept.slice(at)] };
}

/** A new config with `entry` merged into the invested series (same replace-or-insert
 *  discipline as the cash entries). Never mutates the input. */
export function upsertInvested(
  cfg: FinConfig,
  entry: InvestedEntry,
): FinConfig {
  const kept = cfg.invested.filter((e) => e.date !== entry.date);
  const at = insertAt(kept, entry.date);
  return { ...cfg, invested: [...kept.slice(0, at), entry, ...kept.slice(at)] };
}

/**
 * One CSV import, as a pure config transform: parse the CMC export, stamp it
 * `asOf`, store it as the current snapshot, and upsert `today`'s invested total
 * (dollars → cents, rounded, so float drift can't leak into the series). Null when
 * the text isn't a recognizable ProfitLoss export — the caller shows the error and
 * seals nothing.
 */
export function importPortfolioCsv(
  cfg: FinConfig,
  csvText: string,
  opts: { today: string; asOf: string },
): FinConfig | null {
  const parsed = parseCmcCsv(csvText);
  if (!parsed) return null;
  const snapshot: Portfolio = { ...parsed, asOf: opts.asOf };
  return {
    ...upsertInvested(cfg, {
      date: opts.today,
      investedCents: Math.round(parsed.totals.value * 100),
    }),
    portfolio: snapshot,
  };
}

/** The most recent entry (entries are ascending, so the last one); null if empty. */
export function latestEntry(cfg: FinConfig): FinEntry | null {
  return cfg.entries.at(-1) ?? null;
}

/**
 * The cash/HISA/rate in force on `date` — the most recent entry with `entry.date <=
 * date`. Null when no entry reaches back that far (callers read that as "cash unknown
 * → 0", the old unset-env behavior).
 */
export function cashAt(
  cfg: FinConfig,
  date: string,
): { cash: number; hisa: number; rate: number | null } | null {
  let found: FinEntry | null = null;
  for (const e of cfg.entries) {
    if (e.date <= date) found = e;
    else break; // ascending — nothing after this can qualify
  }
  return found && { cash: found.cash, hisa: found.hisa, rate: found.rate };
}

/** A new index with `day` merged in (replace-or-insert, ascending), then trimmed to
 *  the last SNAP_INDEX_MAX_DAYS. The input index is never mutated. */
export function upsertIndexDay(index: SnapIndex, day: SnapIndexDay): SnapIndex {
  const kept = index.days.filter((d) => d.date !== day.date);
  const at = insertAt(kept, day.date);
  const merged = [...kept.slice(0, at), day, ...kept.slice(at)];
  return { v: 1, days: merged.slice(-SNAP_INDEX_MAX_DAYS) };
}

/** The newest reading-index day on or before `cutoff` — the "vs ~7 days ago"
 *  baseline. Scans for the max qualifying date, so unsorted input is fine. */
export function indexBaseline(
  days: SnapIndexDay[],
  cutoff: string,
): SnapIndexDay | null {
  let found: SnapIndexDay | null = null;
  for (const d of days) {
    if (d.date <= cutoff && (!found || d.date > found.date)) found = d;
  }
  return found;
}

/** The invested cents in force on `date` — the most recent entry at or before it;
 *  0 when the series doesn't reach back that far (mirrors the cash "unset → 0"). */
export function investedAt(cfg: FinConfig, date: string): number {
  let found = 0;
  for (const e of cfg.invested) {
    if (e.date <= date) found = e.investedCents;
    else break; // ascending
  }
  return found;
}

/**
 * The net-worth trend series, reconstructed from the two step functions: one point
 * per calendar day across the trailing `days`-day window ending at `today`, each
 * valued as invested-in-force + cash-in-force + HISA-in-force (dollars rounded to
 * cents so float drift can't leak; 3317 → 331700). Days before EITHER series has
 * data are skipped, so a fresh config draws nothing rather than a flat zero line.
 * This replaces the retired sealed-box series byte-for-byte in shape: the boxes
 * only ever sampled a weekly-changing figure daily, which is exactly what this
 * computes — without a server ever holding the figure (ADR 0061).
 */
export function buildStepSeries(
  cfg: FinConfig,
  days: number,
  today: string,
): NetWorthPoint[] {
  const firstData = [cfg.invested[0]?.date, cfg.entries[0]?.date]
    .filter((d): d is string => d !== undefined)
    .sort()[0];
  if (!firstData || days <= 0) return [];

  const windowStart = addDays(today, -(days - 1));
  const start = firstData > windowStart ? firstData : windowStart;
  const points: NetWorthPoint[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const c = cashAt(cfg, d);
    const cash = Math.round((c?.cash ?? 0) * 100);
    const hisa = Math.round((c?.hisa ?? 0) * 100);
    points.push({ date: d, totalCents: investedAt(cfg, d) + cash + hisa });
  }
  return points;
}

/**
 * The delta baseline: the newest point on or before `today` minus `days` calendar
 * days. The cutoff is derived via UTC date math on the `YYYY-MM-DD` (no timezone
 * dependence), and a point that's exactly `days` old counts. Scans for the max
 * qualifying date, so unsorted input is fine. Null when nothing reaches back that far.
 */
export function pickBaseline(
  series: NetWorthPoint[],
  days: number,
  today: string,
): NetWorthPoint | null {
  const cutoff = addDays(today, -days);
  let found: NetWorthPoint | null = null;
  for (const p of series) {
    if (p.date <= cutoff && (!found || p.date > found.date)) found = p;
  }
  return found;
}
