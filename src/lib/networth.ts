import { cashAt, investedAt, type FinConfig } from "./fin";

/**
 * The /portfolio net-worth chart, as pure functions: the per-day series split
 * into its two layers, the range slice, the y-axis ticks and the SVG geometry.
 * No React, no DOM — the component measures its box and draws what these return.
 */

/** One day of net worth, split: investments (market value) and savings (cash +
 *  HISA, kept apart only for the stats line under the chart). Cents throughout. */
export interface SplitPoint {
  date: string;
  investedCents: number;
  hisaCents: number;
  cashCents: number;
  savingsCents: number;
  totalCents: number;
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * One point per calendar day from the first day either series has data through
 * `today` — the same step functions `buildFullSeries` reads (invested in force +
 * cash + HISA in force), split into layers. Empty when there is no data yet.
 */
export function buildSplitSeries(cfg: FinConfig, today: string): SplitPoint[] {
  const first = [cfg.invested[0]?.date, cfg.entries[0]?.date]
    .filter((d): d is string => d !== undefined)
    .sort()[0];
  if (!first || first > today) return [];
  const out: SplitPoint[] = [];
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const c = cashAt(cfg, d);
    const cashCents = Math.round((c?.cash ?? 0) * 100);
    const hisaCents = Math.round((c?.hisa ?? 0) * 100);
    const investedCents = investedAt(cfg, d);
    out.push({
      date: d,
      investedCents,
      hisaCents,
      cashCents,
      savingsCents: cashCents + hisaCents,
      totalCents: investedCents + cashCents + hisaCents,
    });
  }
  return out;
}

export type RangeKey = "1M" | "3M" | "ALL";

/** The range tabs, in order. No 1D/1W: the ledger moves in weekly steps (one
 *  import, one cash re-read a week), so a week is a flat line with one step. */
export const RANGES: { key: RangeKey; days: number | null; word: string }[] = [
  { key: "1M", days: 30, word: "past month" },
  { key: "3M", days: 91, word: "past 3 months" },
  { key: "ALL", days: null, word: "all time" },
];

/** The trailing slice for a range, ending on the series' last day. A slice too
 *  short to draw a line (under two points) falls back to the whole series. */
export function rangeSlice(series: SplitPoint[], key: RangeKey): SplitPoint[] {
  const days = RANGES.find((r) => r.key === key)?.days ?? null;
  const last = series.at(-1);
  if (days === null || !last) return series;
  const from = addDays(last.date, -days);
  const out = series.filter((p) => p.date >= from);
  return out.length >= 2 ? out : series;
}

/** A 1/2/5 × 10ⁿ step at least `raw` — the gridline spacing a chart reads. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** An axis label in whole thousands: 4000000 cents → "$40k". Under $1k it reads
 *  in dollars. */
export function compactAud(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) < 1000) return `$${Math.round(dollars)}`;
  const k = dollars / 1000;
  return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

export type ChartMode = "line" | "split";

export interface ChartGeometry {
  /** The total's polyline as an SVG path. */
  line: string;
  /** The area under the line (line mode) — closed to the plot's floor. */
  area: string;
  /** Split mode: the investments band and the savings band stacked on it. */
  invested: string;
  savings: string;
  /** The y of the range's first total — the dashed "where you started" line. */
  baseY: number;
  /** Gridlines, bottom to top. */
  ticks: { y: number; label: string }[];
  /** Each point's position, for the scrubber's dot and hairline. */
  points: { x: number; y: number }[];
  /** The plot's floor (the x labels sit under it). */
  floor: number;
}

const r = (n: number) => Math.round(n * 10) / 10;

/**
 * Lay a slice out in a `width` × `height` box, `gutter` px reserved on the right
 * for the y labels and `bottom` px under the plot for the x labels. Line mode
 * fits the axis to the data (padded) so a month's move is visible; split mode
 * starts at zero, since stacked layers only read honestly from the floor.
 */
export function chartGeometry(
  pts: SplitPoint[],
  mode: ChartMode,
  width: number,
  height: number,
  gutter: number,
  bottom = 22,
): ChartGeometry {
  const top = 10;
  const floor = height - bottom;
  const plotW = Math.max(1, width - gutter);
  const totals = pts.map((p) => p.totalCents);
  let lo = Math.min(...totals);
  let hi = Math.max(...totals);
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
  if (mode === "split") {
    lo = 0;
    hi = hi + span * 0.06;
  } else {
    lo = lo - span * 0.12;
    hi = hi + span * 0.08;
  }
  const n = pts.length;
  const x = (i: number) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => floor - ((v - lo) / (hi - lo)) * (floor - top);
  const trace = (f: (p: SplitPoint) => number) =>
    pts.map((p, i) => `${i ? "L" : "M"}${r(x(i))},${r(y(f(p)))}`).join("");
  const back = (f: (p: SplitPoint) => number) =>
    pts
      .map((_, k) => {
        const i = n - 1 - k;
        return `L${r(x(i))},${r(y(f(pts[i])))}`;
      })
      .join("");

  const step = niceStep((hi - lo) / 3);
  const ticks: { y: number; label: string }[] = [];
  for (let g = Math.ceil(lo / step) * step; g <= hi; g += step)
    ticks.push({ y: r(y(g)), label: compactAud(g) });

  const line = n ? trace((p) => p.totalCents) : "";
  return {
    line,
    area: n ? `${line}L${r(x(n - 1))},${floor}L${r(x(0))},${floor}Z` : "",
    invested: n ? `${trace((p) => p.investedCents)}${back(() => 0)}Z` : "",
    savings: n
      ? `${trace((p) => p.totalCents)}${back((p) => p.investedCents)}Z`
      : "",
    baseY: n ? r(y(pts[0].totalCents)) : floor,
    ticks,
    points: pts.map((p, i) => ({ x: r(x(i)), y: r(y(p.totalCents)) })),
    floor,
  };
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** "2026-11-26" → "26 nov" — the chart's date register. */
export function chartDay(date: string): string {
  return `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}
