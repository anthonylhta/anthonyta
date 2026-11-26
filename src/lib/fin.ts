import { parseCmcCsv, type Portfolio } from "./portfolio";
import { isValidSeq } from "./seqrule";

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
/** One dated invested total, appended at CSV import time. `investedCents` is
 *  the MARKET value (what net worth adds); `costCents` is the cost basis — what
 *  was actually put in, the only figure the derived spend may subtract, since a
 *  market move is neither money in nor money out. Absent on rows imported before
 *  the cost basis was kept. */
export interface InvestedEntry {
  date: string;
  investedCents: number;
  costCents?: number;
}
/** One dated pay-in, logged from the panel on payday. */
export interface IncomeEntry {
  date: string;
  amountCents: number;
}
/** The standing pay: `amountCents` assumed to land every `everyDays` days from
 *  `since` (a Sydney calendar day, the first assumed payday). A logged income row
 *  in the same pay cycle replaces the assumed figure for that cycle. */
export interface UsualPay {
  amountCents: number;
  everyDays: number;
  since: string;
}
/** The day of the newest invested total — the last weekly buy, since a total is
 *  appended at each CSV import — or null for a ledger with none. The series is
 *  ascending by date, so it is the tail. What the portfolio gu is fed by. */
export function lastInvestedDay(cfg: FinConfig): string | null {
  return cfg.invested[cfg.invested.length - 1]?.date ?? null;
}

/** The fin config — both series ascending by date, one row per day. */
export interface FinConfig {
  v: 2;
  entries: FinEntry[];
  invested: InvestedEntry[];
  portfolio: Portfolio | null;
  /** Sealed write counter (58b rollback detection) — absent on pre-seq blobs,
   *  bumped by every save; the panel compares it to a device high-water mark. */
  seq?: number;
  /** Dated pay-ins — a third step function beside cash and invested. Optional:
   *  every envelope written before the income log existed simply has none. */
  income?: IncomeEntry[];
  /** The standing pay assumed on every payday a row doesn't speak for. Optional:
   *  without it, only logged pay-ins count, as before. */
  usualPay?: UsualPay;
  /** What is owed — sorted by name, unique
   *  case-insensitively. Optional: envelopes before the debts section have none. */
  debts?: DebtEntry[];
  /** Expected recurring debits (the premium, the subscriptions) — sorted by name,
   *  unique case-insensitively. Optional for the same reason `income` is. */
  debits?: DebitEntry[];
  /** RETIRED — the typed weekly burn. Envelopes sealed before the derived burn
   *  (`burnWeekly`) still carry it, so it stays valid; nothing reads it now. */
  burnWeeklyCents?: number;
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
/** A safe integer ≥ 1 — a burn rate of zero is not a denominator. */
function isPosInt(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x > 0;
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
    if (e.costCents !== undefined && !isNonNegInt(e.costCents)) return false;
    if (!(e.date > prev)) return false;
    prev = e.date;
  }
  return true;
}

/** An income series: dated rows, safe-integer cents, strictly ascending — the
 *  invested discipline, applied to what comes in. */
function isIncome(x: unknown): x is IncomeEntry[] {
  if (!Array.isArray(x) || x.length > 4000) return false;
  let prev = "";
  for (const e of x) {
    if (!isObj(e)) return false;
    if (!isYmd(e.date) || !isNonNegInt(e.amountCents)) return false;
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
    isValidSeq(x.seq) &&
    isEntries(x.entries) &&
    isInvested(x.invested) &&
    // Absent is fine — both fields postdate the envelope; present-but-malformed
    // rejects, exactly as `seq` does.
    (x.income === undefined || isIncome(x.income)) &&
    (x.debits === undefined || isDebits(x.debits)) &&
    (x.usualPay === undefined || isUsualPay(x.usualPay)) &&
    (x.debts === undefined || isDebts(x.debts)) &&
    (x.burnWeeklyCents === undefined || isPosInt(x.burnWeeklyCents)) &&
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

/** A new config with `entry` merged into the income series (the same
 *  replace-or-insert discipline as the two series above; an envelope with no
 *  income log yet gains one). Never mutates the input. */
export function upsertIncome(cfg: FinConfig, entry: IncomeEntry): FinConfig {
  const kept = (cfg.income ?? []).filter((e) => e.date !== entry.date);
  const at = insertAt(kept, entry.date);
  return { ...cfg, income: [...kept.slice(0, at), entry, ...kept.slice(at)] };
}

/** Drop the pay-in logged on `date` — the undo for a `pay` typed on the wrong
 *  day, which would otherwise sit newest in the window and speak for the week.
 *  A date with no row is a no-op. */
export function removeIncome(cfg: FinConfig, date: string): FinConfig {
  return { ...cfg, income: (cfg.income ?? []).filter((e) => e.date !== date) };
}

/** How far back "this week" reaches, `todayISO` included. */
const WEEK_DAYS = 7;

/** The trailing week's first day — the cutoff both weekly readings share. */
function weekStart(todayISO: string): string {
  return addDays(todayISO, -(WEEK_DAYS - 1));
}

/** Longest usual-pay cadence — monthly-ish. */
const USUAL_PAY_EVERY_MAX = 31;

/** A usual pay: whole cents above zero, a 1–31 day cadence, a real first day. */
function isUsualPay(x: unknown): x is UsualPay {
  return (
    isObj(x) &&
    isPosInt(x.amountCents) &&
    isPosInt(x.everyDays) &&
    x.everyDays <= USUAL_PAY_EVERY_MAX &&
    isCalendarDay(x.since)
  );
}

/** A new config with the usual pay set, or cleared with null. */
export function setUsualPay(cfg: FinConfig, pay: UsualPay | null): FinConfig {
  const next = { ...cfg };
  if (pay === null) delete next.usualPay;
  else next.usualPay = pay;
  return next;
}

/** One pay-in as the readings count it — logged, or the usual pay assumed. */
export interface PayEvent {
  date: string;
  amountCents: number;
  assumed: boolean;
}

/**
 * Every pay-in dated in `(from, to]`, ascending: each logged income row, plus the
 * usual pay on each of its paydays that no logged row speaks for. A payday's
 * cycle is centred on it (a weekly payday owns the three days either side), so a
 * pay logged a day early or late still replaces that week's assumption rather
 * than adding to it — and a logged row is the WHOLE cycle's income, so a week
 * with a refund logs pay + refund, never the refund alone.
 */
export function payEvents(
  cfg: FinConfig,
  from: string,
  to: string,
): PayEvent[] {
  const income = cfg.income ?? [];
  const out: PayEvent[] = income
    .filter((e) => e.date > from && e.date <= to)
    .map((e) => ({ date: e.date, amountCents: e.amountCents, assumed: false }));
  const usual = cfg.usualPay;
  if (usual) {
    const every = usual.everyDays;
    const before = Math.floor(every / 2);
    // The first payday after `from` — never before `since`.
    const gap = daysBetween(usual.since, from);
    let k = gap < 0 ? 0 : Math.floor(gap / every) + 1;
    for (; ; k++) {
      const day = addDays(usual.since, k * every);
      if (day > to) break;
      if (day <= from) continue;
      const lo = addDays(day, -before);
      const hi = addDays(day, every - before); // exclusive
      if (income.some((e) => e.date >= lo && e.date < hi)) continue;
      out.push({ date: day, amountCents: usual.amountCents, assumed: true });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The trailing week's pay, in cents: the newest pay-in (logged or assumed) dated
 * within it. Null when the week holds none — the panel renders a dash rather than
 * a zero, because "nothing logged" and "nothing earned" are different facts and
 * only one of them is knowable here. Entries dated ahead of `todayISO` are
 * ignored: a future row is not this week's pay.
 */
export function recoveredThisWeek(
  cfg: FinConfig,
  todayISO: string,
): number | null {
  return payThisWeek(cfg, todayISO)?.amountCents ?? null;
}

/** The pay-in `recoveredThisWeek` reads, with its day and whether it was assumed. */
export function payThisWeek(cfg: FinConfig, todayISO: string): PayEvent | null {
  return payEvents(cfg, addDays(todayISO, -WEEK_DAYS), todayISO).at(-1) ?? null;
}

/** The cost basis in force on `date`, in cents: 0 before anything was bought,
 *  null when the row in force predates the cost basis being kept. */
function costAt(cfg: FinConfig, date: string): number | null {
  let found: InvestedEntry | null = null;
  for (const e of cfg.invested) {
    if (e.date <= date) found = e;
    else break; // ascending
  }
  if (found === null) return 0;
  return found.costCents ?? null;
}

/**
 * What was PUT AWAY over the trailing week: the newest invested step inside it,
 * less the step before it (less zero when it is the first step ever — the whole
 * figure was absorbed). Null when no import landed this week, which is the honest
 * answer during a week with no buy rather than a manufactured 0. Read off the
 * cost basis when both steps carry one, so a market move is never "put away";
 * older rows without it fall back to the market value they were stored with.
 */
export function absorbedThisWeek(
  cfg: FinConfig,
  todayISO: string,
): number | null {
  const cutoff = weekStart(todayISO);
  let at = -1;
  for (let i = 0; i < cfg.invested.length; i++) {
    const e = cfg.invested[i];
    if (e.date >= cutoff && e.date <= todayISO) at = i; // ascending — last wins
  }
  if (at < 0) return null;
  const now = cfg.invested[at];
  const prev = at > 0 ? cfg.invested[at - 1] : null;
  if (now.costCents !== undefined && (!prev || prev.costCents !== undefined))
    return now.costCents - (prev?.costCents ?? 0);
  return now.investedCents - (prev?.investedCents ?? 0);
}

/**
 * What went out between two balance re-reads `a` < `b`, in cents: the pay that
 * came in over `(a, b]`, less what the cost basis rose by, less whatever the cash
 * + HISA balance rose by (a fall counts as spent). Only the two ENDS are read, so
 * a slip in between — a balance typed before a buy filled, a pay typed late —
 * cancels out instead of landing on one week. Null when either end's cost basis
 * is unknown. Negative is possible and honest: a refund or interest landed.
 */
function spentBetween(cfg: FinConfig, a: string, b: string): number | null {
  const costA = costAt(cfg, a);
  const costB = costAt(cfg, b);
  const balA = cashAt(cfg, a);
  const balB = cashAt(cfg, b);
  if (costA === null || costB === null || !balA || !balB) return null;
  const pay = payEvents(cfg, a, b).reduce((s, e) => s + e.amountCents, 0);
  const rise = Math.round(
    (balB.cash + balB.hisa - balA.cash - balA.hisa) * 100,
  );
  return pay - (costB - costA) - rise;
}

/** A spend read over a span of re-reads. `cents` is per week; `totalCents` is
 *  the whole span, `from` → `to` its two re-read days. */
export interface SpendRead {
  cents: number;
  weeks: number;
  totalCents: number;
  from: string;
  to: string;
}

/** The span the burn reads over — long enough to swallow the monthly charges
 *  that land in one week and not the next, and to thin out a slipped end. */
const BURN_DAYS = 28;

/** The re-read days on or before `todayISO` whose cost basis is known. */
function knownRereads(cfg: FinConfig, todayISO: string): string[] {
  return cfg.entries
    .filter((e) => e.date <= todayISO && costAt(cfg, e.date) !== null)
    .map((e) => e.date);
}

/** The read over `a` → `b`, or null when either end is unknowable. */
function spendRead(cfg: FinConfig, a: string, b: string): SpendRead | null {
  const total = spentBetween(cfg, a, b);
  if (total === null) return null;
  const days = daysBetween(a, b);
  return {
    cents: Math.round((total * WEEK_DAYS) / days),
    weeks: Math.max(1, Math.round(days / WEEK_DAYS)),
    totalCents: total,
    from: a,
    to: b,
  };
}

/**
 * The weekly burn as the site divides by it: the spend between the newest
 * balance re-read and the re-read about four weeks before it, per week. Falls back
 * to the longest shorter span (a week at least) while the history is young;
 * `weeks` says how long the span is so a reader can tell a one-week figure from a
 * settled one. Null until two re-reads a week apart are knowable.
 */
export function burnWeekly(cfg: FinConfig, todayISO: string): SpendRead | null {
  const days = knownRereads(cfg, todayISO);
  const b = days.at(-1);
  if (b === undefined) return null;
  const starts = days.filter((d) => daysBetween(d, b) >= WEEK_DAYS);
  if (starts.length === 0) return null;
  const settled = starts.filter((d) => daysBetween(d, b) >= BURN_DAYS).at(-1);
  return spendRead(cfg, settled ?? starts[0], b);
}

/** The first day of `todayISO`'s calendar quarter — Jan, Apr, Jul or Oct 1st. */
export function quarterStart(todayISO: string): string {
  const month = Number(todayISO.slice(5, 7));
  const first = month - ((month - 1) % 3);
  return `${todayISO.slice(0, 4)}-${String(first).padStart(2, "0")}-01`;
}

/**
 * What went out so far this quarter: the spend from the re-read in force at the
 * quarter's first day (or, when that one's cost basis is unknown, the first
 * knowable re-read inside the quarter) to the newest re-read. `weeks` says how
 * long the span is. Null until the quarter holds a knowable span.
 */
export function spentThisQuarter(
  cfg: FinConfig,
  todayISO: string,
): { cents: number; weeks: number } | null {
  const start = quarterStart(todayISO);
  const days = knownRereads(cfg, todayISO);
  const b = days.at(-1);
  if (b === undefined || b <= start) return null;
  const a =
    days.filter((d) => d <= start).at(-1) ??
    days.find((d) => d < b && d > start);
  if (a === undefined) return null;
  const read = spendRead(cfg, a, b);
  return read && { cents: read.totalCents, weeks: read.weeks };
}

/** How many weeks of flow the /aperture strips read back over. */
const FLOW_WEEKS = 10;

/**
 * The trailing weeks of the stones ledger as two series, oldest → newest: what came
 * IN each week, and what share of it was put away. Each point is the SAME reading
 * the ledger prints for this week, taken again with the anchor moved back seven
 * days at a time — so a strip and the stat above it can never disagree about a
 * week, because they are one function.
 *
 * Nothing is padded. A week with no pay logged contributes no recovered point, and
 * a week without both ends (or one with nothing recovered to divide by) contributes
 * no rate point — the record band's rule, for the same reason: a zero the site made
 * up would draw a collapse that never happened. The two series are therefore
 * independent lengths, and each is drawn only once it has two points to draw.
 *
 * Absorbed itself is deliberately not a series here: on a weekly buy it is near
 * constant by construction, so a flat line would be chrome. The RATE is what moves.
 */
export function weeklyFlow(
  cfg: FinConfig,
  todayISO: string,
  weeks: number = FLOW_WEEKS,
): { recovered: number[]; rate: number[] } {
  const recovered: number[] = [];
  const rate: number[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const anchor = addDays(todayISO, -WEEK_DAYS * k);
    const inn = recoveredThisWeek(cfg, anchor);
    const away = absorbedThisWeek(cfg, anchor);
    if (inn === null) continue;
    recovered.push(inn);
    if (away !== null && inn > 0) rate.push(Math.round((away / inn) * 100));
  }
  return { recovered, rate };
}

/**
 * The newest invested row with its cost basis filled from the stored snapshot,
 * when it predates the cost basis being kept. Safe only because the snapshot and
 * the newest row are written by the same import — and checked: the snapshot's
 * market value must match the row's, or the row is left alone.
 */
function withCostBackfill(cfg: FinConfig): FinConfig {
  const last = cfg.invested.at(-1);
  const snap = cfg.portfolio;
  if (!last || last.costCents !== undefined || !snap) return cfg;
  if (Math.round(snap.totals.value * 100) !== last.investedCents) return cfg;
  return upsertInvested(cfg, {
    ...last,
    costCents: Math.round(snap.totals.cost * 100),
  });
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
    ...upsertInvested(withCostBackfill(cfg), {
      date: opts.today,
      investedCents: Math.round(parsed.totals.value * 100),
      costCents: Math.round(parsed.totals.cost * 100),
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
 * The all-time trend series: every day from the FIRST dated entry (invested or
 * cash, whichever is older) through `today`. The savings staircase is the whole
 * story — a windowed slice of a step function is mostly flat and reads as "no
 * progress" between paydays — so the portfolio chart draws the full duration
 * and simply gets better every month.
 */
export function buildFullSeries(
  cfg: FinConfig,
  today: string,
): NetWorthPoint[] {
  const firstData = [cfg.invested[0]?.date, cfg.entries[0]?.date]
    .filter((d): d is string => d !== undefined)
    .sort()[0];
  if (!firstData || firstData > today) return [];
  const span =
    Math.round(
      (Date.parse(`${today}T00:00:00Z`) -
        Date.parse(`${firstData}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return buildStepSeries(cfg, span, today);
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

/**
 * The month-to-date baseline: the newest point BEFORE the first of `today`'s
 * month — i.e. where the ledger stood as last month ended. On weekly pay a
 * 7-day Δ just echoes whether payday happened yet; "saved this month" resets
 * at a boundary that means something. Null during the first month of data
 * (no full boundary crossed yet — the glance hides the Δ rather than fake one).
 */
export function monthToDateBaseline(
  series: NetWorthPoint[],
  today: string,
): NetWorthPoint | null {
  const monthStart = `${today.slice(0, 7)}-01`;
  let found: NetWorthPoint | null = null;
  for (const p of series) {
    if (p.date < monthStart && (!found || p.date > found.date)) found = p;
  }
  return found;
}

/** One expected recurring debit — a charge that lands every `everyDays` days,
 *  anchored on the last one seen (`last`, a Sydney calendar day). */
export interface DebitEntry {
  name: string;
  amountCents: number;
  everyDays: number;
  last: string;
}

/** How many debit rows an envelope may carry. */
const DEBITS_MAX = 50;
/** Longest debit name, after trimming. */
const DEBIT_NAME_MAX = 60;
/** Longest cadence — a yearly charge, leap year included. */
const DEBIT_EVERY_MAX = 366;

/** A real calendar day, not just the `YYYY-MM-DD` shape (no 02-30). */
function isCalendarDay(x: unknown): x is string {
  return isYmd(x) && addDays(x, 0) === x;
}

/** A debits list: trimmed 1–60 char names, whole cents, a 1–366 day cadence, a
 *  real `last` day — strictly ascending by lower-cased name, which is both the
 *  sort and the case-insensitive uniqueness rule in one pass. */
function isDebits(x: unknown): x is DebitEntry[] {
  if (!Array.isArray(x) || x.length > DEBITS_MAX) return false;
  let prev = "";
  for (const e of x) {
    if (!isObj(e) || typeof e.name !== "string") return false;
    const key = e.name.toLowerCase();
    if (e.name.trim() !== e.name || e.name.length === 0) return false;
    if (e.name.length > DEBIT_NAME_MAX) return false;
    if (!isNonNegInt(e.amountCents) || !isCalendarDay(e.last)) return false;
    if (!isPosInt(e.everyDays) || e.everyDays > DEBIT_EVERY_MAX) return false;
    if (!(key > prev)) return false;
    prev = key;
  }
  return true;
}

/**
 * A new config with `entry` in the debits list — its name trimmed, replacing a
 * row of the same name (case-insensitively), else inserted in name order. Never
 * mutates the input; the caller validates the fields.
 */
export function upsertDebit(cfg: FinConfig, entry: DebitEntry): FinConfig {
  const row = { ...entry, name: entry.name.trim() };
  const key = row.name.toLowerCase();
  const kept = (cfg.debits ?? []).filter((d) => d.name.toLowerCase() !== key);
  const at = kept.findIndex((d) => d.name.toLowerCase() > key);
  const i = at < 0 ? kept.length : at;
  return { ...cfg, debits: [...kept.slice(0, i), row, ...kept.slice(i)] };
}

/** A new config without the debit named `name` (case-insensitively). */
export function removeDebit(cfg: FinConfig, name: string): FinConfig {
  const key = name.trim().toLowerCase();
  return {
    ...cfg,
    debits: (cfg.debits ?? []).filter((d) => d.name.toLowerCase() !== key),
  };
}

/** Whole calendar days from `a` to `b` (negative when `b` is earlier). */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * The day the debit last fell due on or before `todayISO`: the latest day on the
 * `last + k·everyDays` grid (k ≥ 0) not after today — `last` itself when today
 * is still before it. The ledger dates the charge from its cadence; a debit that
 * moved (a public holiday, a changed plan) is corrected by re-typing `last`.
 */
export function debitDueDay(entry: DebitEntry, todayISO: string): string {
  const gap = daysBetween(entry.last, todayISO);
  if (gap <= 0) return entry.last;
  const k = Math.floor(gap / entry.everyDays);
  return addDays(entry.last, k * entry.everyDays);
}

/** The first day on the same grid strictly after `todayISO`. */
export function debitNextDay(entry: DebitEntry, todayISO: string): string {
  if (todayISO < entry.last) return entry.last;
  return addDays(debitDueDay(entry, todayISO), entry.everyDays);
}

/** The name a gu's `log` uses for a debit: `debit:` + the lower-cased name. */
export function debitLogKey(name: string): string {
  return `debit:${name.trim().toLowerCase()}`;
}

/** Every debit's due day, keyed by its log name — the map a gu's clock reads. */
export function debitDays(
  cfg: FinConfig,
  todayISO: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of cfg.debits ?? [])
    out[debitLogKey(d.name)] = debitDueDay(d, todayISO);
  return out;
}

/** What the debits commit per week, in cents: each amount spread over its
 *  cadence (× 7 / everyDays, rounded per row) and summed. */
export function committedWeeklyCents(cfg: FinConfig): number {
  let sum = 0;
  for (const d of cfg.debits ?? [])
    sum += Math.round((d.amountCents * 7) / d.everyDays);
  return sum;
}

/** One dated balance of a debt, in cents. */
export interface DebtBalance {
  date: string;
  balanceCents: number;
}

/** A repayment plan: `amountCents` comes off every `everyDays` days from `next`
 *  (the first payment day), until the balance reaches zero. */
export interface DebtPlan {
  amountCents: number;
  everyDays: number;
  next: string;
}

/** One debt — its typed balances (ascending, one per day) and an optional plan
 *  that steps the balance down between them. */
export interface DebtEntry {
  name: string;
  balances: DebtBalance[];
  plan?: DebtPlan;
}

/** How many debts an envelope may carry, and balances per debt. */
const DEBTS_MAX = 20;
const DEBT_BALANCES_MAX = 400;
/** Longest plan cadence — a monthly plan, with room. */
const DEBT_EVERY_MAX = 31;

function isDebtPlan(x: unknown): x is DebtPlan {
  return (
    isObj(x) &&
    isPosInt(x.amountCents) &&
    isPosInt(x.everyDays) &&
    x.everyDays <= DEBT_EVERY_MAX &&
    isCalendarDay(x.next)
  );
}

/** A debts list: trimmed 1–60 char names, strictly ascending by lower-cased name
 *  (sort + case-insensitive uniqueness), each with 1–400 ascending real-day
 *  balances in whole cents and an optional valid plan. */
function isDebts(x: unknown): x is DebtEntry[] {
  if (!Array.isArray(x) || x.length > DEBTS_MAX) return false;
  let prev = "";
  for (const e of x) {
    if (!isObj(e) || typeof e.name !== "string") return false;
    if (e.name.trim() !== e.name || e.name.length === 0) return false;
    if (e.name.length > DEBIT_NAME_MAX) return false;
    const key = e.name.toLowerCase();
    if (!(key > prev)) return false;
    prev = key;
    if (!Array.isArray(e.balances) || e.balances.length === 0) return false;
    if (e.balances.length > DEBT_BALANCES_MAX) return false;
    let day = "";
    for (const b of e.balances) {
      if (!isObj(b) || !isCalendarDay(b.date) || !isNonNegInt(b.balanceCents))
        return false;
      if (!(b.date > day)) return false;
      day = b.date;
    }
    if (e.plan !== undefined && !isDebtPlan(e.plan)) return false;
  }
  return true;
}

/**
 * What a debt stands at on `date`, in cents: the newest typed balance on or
 * before it, less every plan payment due after that balance's day and on or
 * before `date` — never below zero. 0 before its first balance (it didn't exist).
 */
export function debtBalanceAt(debt: DebtEntry, date: string): number {
  let found: DebtBalance | null = null;
  for (const b of debt.balances) {
    if (b.date <= date) found = b;
    else break; // ascending
  }
  if (!found) return 0;
  const plan = debt.plan;
  if (!plan) return found.balanceCents;
  // Payment days are plan.next + k·everyDays (k ≥ 0); count those in (found, date].
  const upTo = daysBetween(plan.next, date);
  if (upTo < 0) return found.balanceCents;
  const after = daysBetween(plan.next, found.date);
  const paidBy = (gap: number) =>
    gap < 0 ? 0 : Math.floor(gap / plan.everyDays) + 1;
  const payments = paidBy(upTo) - paidBy(after);
  return Math.max(0, found.balanceCents - payments * plan.amountCents);
}

/** Everything owed on `date`, in cents. */
export function debtsAt(cfg: FinConfig, date: string): number {
  let sum = 0;
  for (const d of cfg.debts ?? []) sum += debtBalanceAt(d, date);
  return sum;
}

/**
 * A new config with the debt named `name` at `balanceCents` on `date` — a new
 * debt is inserted in name order, an existing one (case-insensitively) gets the
 * dated balance merged in (same-day replace). `plan` replaces the plan when given;
 * null clears it; undefined keeps it. Never mutates the input.
 */
export function upsertDebt(
  cfg: FinConfig,
  name: string,
  date: string,
  balanceCents: number,
  plan?: DebtPlan | null,
): FinConfig {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  const list = cfg.debts ?? [];
  const old = list.find((d) => d.name.toLowerCase() === key);
  const kept = (old?.balances ?? []).filter((b) => b.date !== date);
  const at = insertAt(kept, date);
  const row: DebtEntry = {
    name: old?.name ?? trimmed,
    balances: [
      ...kept.slice(0, at),
      { date, balanceCents },
      ...kept.slice(at),
    ].slice(-DEBT_BALANCES_MAX),
  };
  const nextPlan = plan === undefined ? old?.plan : (plan ?? undefined);
  if (nextPlan) row.plan = nextPlan;
  const rest = list.filter((d) => d.name.toLowerCase() !== key);
  const i = rest.findIndex((d) => d.name.toLowerCase() > key);
  const pos = i < 0 ? rest.length : i;
  return { ...cfg, debts: [...rest.slice(0, pos), row, ...rest.slice(pos)] };
}

/** A new config without the debt named `name` (case-insensitively). */
export function removeDebt(cfg: FinConfig, name: string): FinConfig {
  const key = name.trim().toLowerCase();
  return {
    ...cfg,
    debts: (cfg.debts ?? []).filter((d) => d.name.toLowerCase() !== key),
  };
}
