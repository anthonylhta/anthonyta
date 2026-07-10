/**
 * Pure helpers + types for the E2EE financial layer (ADR: sealed net worth) — the
 * cash/HISA config envelope and the sealed daily snapshot boxes both decrypt on the
 * client, so this layer only ever sees already-plaintext JSON. No `next`,
 * `@vercel/blob`, or `react` import and no Node-only APIs, so it's safe in a client
 * component and unit-testable on its own (mirrors lib/files, lib/activity).
 *
 * The cash config supersedes the old `CASH_AUD`/`HISA_AUD` env (lib/cash): a dated,
 * ascending series of balances instead of a single current value, so a snapshot can
 * be valued with the cash that was true ON its day. Callers that find no entry on or
 * before a day treat it as 0 — the same "unset → 0" behavior the env had.
 */

/** fin-config envelope cap, enforced at the route before decryption. */
export const FIN_MAX_BYTES = 32768;
/** snapkey JSON cap (the wrapped per-box key material). */
export const SNAPKEY_MAX_BYTES = 8192;
/** How many days of the plaintext reading index we retain before trimming. */
export const SNAP_INDEX_MAX_DAYS = 400;

/** One dated cash/HISA balance. `date` is a Sydney calendar day, `YYYY-MM-DD`. */
export interface FinEntry {
  date: string;
  cash: number;
  hisa: number;
  rate: number | null;
}
/** The cash/HISA config — entries ascending by date, one per day. */
export interface FinConfig {
  v: 1;
  entries: FinEntry[];
}
/** The plaintext payload sealed inside one daily snapshot box. */
export interface SnapBoxPayload {
  v: 1;
  date: string;
  investedCents: number;
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

/**
 * Strict runtime guard for a decrypted fin-config: `v === 1`, an entries array of at
 * most 4000 rows, each with a well-formed date, non-negative finite cash/HISA, a
 * rate that's a non-negative finite number or null, and dates strictly ascending
 * (which also forces them unique). Anything off that shape → false.
 */
export function isFinConfig(x: unknown): x is FinConfig {
  if (!isObj(x) || x.v !== 1 || !Array.isArray(x.entries)) return false;
  if (x.entries.length > 4000) return false;
  let prev = "";
  for (const e of x.entries) {
    if (!isObj(e)) return false;
    if (!isYmd(e.date) || !isNonNegNum(e.cash) || !isNonNegNum(e.hisa))
      return false;
    if (!(e.rate === null || isNonNegNum(e.rate))) return false;
    if (!(e.date > prev)) return false; // strictly ascending (prev "" first)
    prev = e.date;
  }
  return true;
}

/** Strict guard for a sealed-box payload: `v === 1`, a dated day, and a non-negative
 *  safe-integer cents amount. */
export function isSnapBoxPayload(x: unknown): x is SnapBoxPayload {
  return isObj(x) && x.v === 1 && isYmd(x.date) && isNonNegInt(x.investedCents);
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

/** A new config with `entry` merged in — replacing a same-day row, else inserted so
 *  the entries stay ascending. The input config is never mutated. */
export function upsertEntry(cfg: FinConfig, entry: FinEntry): FinConfig {
  const kept = cfg.entries.filter((e) => e.date !== entry.date);
  const at = insertAt(kept, entry.date);
  return { v: 1, entries: [...kept.slice(0, at), entry, ...kept.slice(at)] };
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

/**
 * The net-worth trend series from the sealed boxes: boxes sorted ascending and
 * deduped by date (last box wins), each valued as
 * `investedCents + cash-in-cents + hisa-in-cents` using the cash config in force on
 * that day. Dollar balances round to cents so float drift can't leak (3317 → 331700).
 * A day with no cash entry yet contributes invested only.
 */
export function buildNetWorthSeries(
  boxes: SnapBoxPayload[],
  cfg: FinConfig,
): NetWorthPoint[] {
  const byDate = new Map<string, SnapBoxPayload>();
  for (const b of boxes) byDate.set(b.date, b); // last write wins
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => {
      const c = cashAt(cfg, b.date);
      const cash = Math.round((c?.cash ?? 0) * 100);
      const hisa = Math.round((c?.hisa ?? 0) * 100);
      return { date: b.date, totalCents: b.investedCents + cash + hisa };
    });
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
