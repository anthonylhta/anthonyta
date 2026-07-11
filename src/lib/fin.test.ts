import { describe, expect, it } from "vitest";
import {
  buildStepSeries,
  cashAt,
  importPortfolioCsv,
  indexBaseline,
  investedAt,
  isFinConfig,
  isPortfolioSnapshot,
  isSnapIndex,
  latestEntry,
  normalizeFinConfig,
  pickBaseline,
  SNAP_INDEX_MAX_DAYS,
  sydneyDaysAgo,
  sydneyToday,
  upsertEntry,
  upsertInvested,
  upsertIndexDay,
  type FinConfig,
  type NetWorthPoint,
  type SnapIndex,
  type SnapIndexDay,
} from "./fin";
import type { Portfolio } from "./portfolio";

// Ascending, unique dates from a fixed epoch — for building oversized/full fixtures.
const dayFromEpoch = (i: number) =>
  new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);

/** A v2 config with defaults, overridable per test. */
const cfg2 = (partial: Partial<Omit<FinConfig, "v">> = {}): FinConfig => ({
  v: 2,
  entries: [],
  invested: [],
  portfolio: null,
  ...partial,
});

const SNAPSHOT: Portfolio = {
  asOf: "12 Jul, 14:30",
  holdings: [
    {
      code: "NDQ",
      units: 40,
      last: 50.1,
      value: 2004,
      cost: 1800,
      dayGain: 12.4,
      pnl: 204,
      pnlPct: 11.3,
    },
  ],
  totals: { value: 2004, cost: 1800, dayGain: 12.4, pnl: 204, pnlPct: 11.3 },
};

describe("isFinConfig", () => {
  const valid = cfg2({
    entries: [
      { date: "2026-06-20", cash: 100, hisa: 200, rate: 4.5 },
      { date: "2026-06-25", cash: 150, hisa: 0, rate: null },
    ],
    invested: [{ date: "2026-06-22", investedCents: 200400 }],
    portfolio: SNAPSHOT,
  });
  it("accepts a well-formed config, including an empty one", () => {
    expect(isFinConfig(valid)).toBe(true);
    expect(isFinConfig(cfg2())).toBe(true);
  });
  it("rejects a wrong version or a non-object (v1 goes through normalize)", () => {
    expect(isFinConfig({ v: 1, entries: [] })).toBe(false);
    expect(isFinConfig(null)).toBe(false);
    expect(isFinConfig("nope")).toBe(false);
    expect(isFinConfig({ ...cfg2(), entries: "no" })).toBe(false);
    expect(isFinConfig({ ...cfg2(), invested: "no" })).toBe(false);
  });
  it("rejects a bad date shape", () => {
    const bad = (date: unknown) =>
      cfg2({
        entries: [{ date: date as string, cash: 1, hisa: 1, rate: null }],
      });
    expect(isFinConfig(bad("2026-6-1"))).toBe(false);
    expect(isFinConfig(bad("not-a-date"))).toBe(false);
    expect(isFinConfig(bad(20260601))).toBe(false);
  });
  it("rejects negative, NaN, or Infinity numbers", () => {
    const one = (extra: object) =>
      cfg2({
        entries: [{ date: "2026-06-20", cash: 0, hisa: 0, rate: 0, ...extra }],
      });
    expect(isFinConfig(one({ cash: -1 }))).toBe(false);
    expect(isFinConfig(one({ hisa: NaN }))).toBe(false);
    expect(isFinConfig(one({ cash: Infinity }))).toBe(false);
    expect(isFinConfig(one({ rate: -2 }))).toBe(false);
    expect(isFinConfig(one({ rate: undefined }))).toBe(false); // must be number|null
  });
  it("rejects non-ascending or duplicate dates in either series", () => {
    const entrySeq = (a: string, b: string) =>
      cfg2({
        entries: [
          { date: a, cash: 1, hisa: 1, rate: null },
          { date: b, cash: 1, hisa: 1, rate: null },
        ],
      });
    expect(isFinConfig(entrySeq("2026-06-25", "2026-06-20"))).toBe(false);
    expect(isFinConfig(entrySeq("2026-06-20", "2026-06-20"))).toBe(false);
    const investedSeq = (a: string, b: string) =>
      cfg2({
        invested: [
          { date: a, investedCents: 1 },
          { date: b, investedCents: 2 },
        ],
      });
    expect(isFinConfig(investedSeq("2026-06-25", "2026-06-20"))).toBe(false);
    expect(isFinConfig(investedSeq("2026-06-20", "2026-06-20"))).toBe(false);
  });
  it("rejects bad invested cents (negative, fractional, NaN)", () => {
    const one = (investedCents: number) =>
      cfg2({ invested: [{ date: "2026-06-20", investedCents }] });
    expect(isFinConfig(one(-1))).toBe(false);
    expect(isFinConfig(one(1.5))).toBe(false);
    expect(isFinConfig(one(NaN))).toBe(false);
  });
  it("rejects oversized series (> 4000)", () => {
    const entries = Array.from({ length: 4001 }, (_, i) => ({
      date: dayFromEpoch(i),
      cash: 0,
      hisa: 0,
      rate: null,
    }));
    expect(isFinConfig(cfg2({ entries }))).toBe(false);
    const invested = Array.from({ length: 4001 }, (_, i) => ({
      date: dayFromEpoch(i),
      investedCents: 0,
    }));
    expect(isFinConfig(cfg2({ invested }))).toBe(false);
  });
});

describe("isPortfolioSnapshot", () => {
  it("accepts a well-formed snapshot, with or without holdings", () => {
    expect(isPortfolioSnapshot(SNAPSHOT)).toBe(true);
    expect(isPortfolioSnapshot({ ...SNAPSHOT, holdings: [] })).toBe(true);
  });
  it("allows negative gains and P&L (losses are numbers too)", () => {
    expect(
      isPortfolioSnapshot({
        ...SNAPSHOT,
        totals: { ...SNAPSHOT.totals, dayGain: -50, pnl: -100, pnlPct: -5.2 },
      }),
    ).toBe(true);
  });
  it("rejects a bad code, a non-finite figure, or oversized shapes", () => {
    const withHolding = (extra: object) => ({
      ...SNAPSHOT,
      holdings: [{ ...SNAPSHOT.holdings[0], ...extra }],
    });
    expect(isPortfolioSnapshot(withHolding({ code: "" }))).toBe(false);
    expect(isPortfolioSnapshot(withHolding({ code: "X".repeat(21) }))).toBe(
      false,
    );
    expect(isPortfolioSnapshot(withHolding({ value: NaN }))).toBe(false);
    expect(isPortfolioSnapshot(withHolding({ pnl: Infinity }))).toBe(false);
    expect(isPortfolioSnapshot({ ...SNAPSHOT, asOf: "x".repeat(101) })).toBe(
      false,
    );
    expect(
      isPortfolioSnapshot({
        ...SNAPSHOT,
        holdings: Array.from({ length: 501 }, () => SNAPSHOT.holdings[0]),
      }),
    ).toBe(false);
    expect(isPortfolioSnapshot(null)).toBe(false);
  });
});

describe("normalizeFinConfig", () => {
  it("passes a v2 config through untouched", () => {
    const v2 = cfg2({ portfolio: SNAPSHOT });
    expect(normalizeFinConfig(v2)).toBe(v2);
  });
  it("lifts a v1 (cash-only) config to v2 with empty invested + portfolio", () => {
    const entries = [{ date: "2026-06-20", cash: 100, hisa: 0, rate: null }];
    expect(normalizeFinConfig({ v: 1, entries })).toEqual(cfg2({ entries }));
  });
  it("is null for anything unrecognizable — never a guessed shape", () => {
    expect(normalizeFinConfig(null)).toBeNull();
    expect(normalizeFinConfig({ v: 3, entries: [] })).toBeNull();
    expect(normalizeFinConfig({ v: 1, entries: "no" })).toBeNull();
    expect(
      normalizeFinConfig({ v: 2, entries: [], invested: [], portfolio: 42 }),
    ).toBeNull();
  });
});

describe("isSnapIndex", () => {
  const valid: SnapIndex = {
    v: 1,
    days: [
      { date: "2026-06-20", readingChapters: 3 },
      { date: "2026-06-21", readingChapters: 5 },
    ],
  };
  it("accepts a well-formed index, including an empty one", () => {
    expect(isSnapIndex(valid)).toBe(true);
    expect(isSnapIndex({ v: 1, days: [] })).toBe(true);
  });
  it("rejects a wrong version or non-array days", () => {
    expect(isSnapIndex({ v: 0, days: [] })).toBe(false);
    expect(isSnapIndex({ v: 1, days: {} })).toBe(false);
    expect(isSnapIndex(null)).toBe(false);
  });
  it("rejects a bad date or a non-integer chapter count", () => {
    const one = (extra: object) => ({
      v: 1,
      days: [{ date: "2026-06-20", readingChapters: 0, ...extra }],
    });
    expect(isSnapIndex(one({ date: "6/20" }))).toBe(false);
    expect(isSnapIndex(one({ readingChapters: -1 }))).toBe(false);
    expect(isSnapIndex(one({ readingChapters: 2.5 }))).toBe(false);
    expect(isSnapIndex(one({ readingChapters: Infinity }))).toBe(false);
  });
  it("rejects non-ascending days", () => {
    expect(
      isSnapIndex({
        v: 1,
        days: [
          { date: "2026-06-21", readingChapters: 1 },
          { date: "2026-06-20", readingChapters: 1 },
        ],
      }),
    ).toBe(false);
  });
  it("rejects an index past the 500-day slack cap", () => {
    const days = Array.from({ length: 501 }, (_, i) => ({
      date: dayFromEpoch(i),
      readingChapters: 0,
    }));
    expect(isSnapIndex({ v: 1, days })).toBe(false);
  });
});

describe("upsertEntry / upsertInvested", () => {
  const base = cfg2({
    entries: [
      { date: "2026-06-10", cash: 1, hisa: 1, rate: null },
      { date: "2026-06-30", cash: 3, hisa: 3, rate: null },
    ],
    invested: [{ date: "2026-06-15", investedCents: 100 }],
    portfolio: SNAPSHOT,
  });
  it("inserts a middle entry keeping ascending order", () => {
    const out = upsertEntry(base, {
      date: "2026-06-20",
      cash: 2,
      hisa: 2,
      rate: 4,
    });
    expect(out.entries.map((e) => e.date)).toEqual([
      "2026-06-10",
      "2026-06-20",
      "2026-06-30",
    ]);
    expect(isFinConfig(out)).toBe(true);
  });
  it("preserves the other series and the snapshot", () => {
    const out = upsertEntry(base, {
      date: "2026-07-05",
      cash: 5,
      hisa: 5,
      rate: null,
    });
    expect(out.invested).toEqual(base.invested);
    expect(out.portfolio).toBe(base.portfolio);
    const out2 = upsertInvested(base, {
      date: "2026-07-05",
      investedCents: 999,
    });
    expect(out2.entries).toEqual(base.entries);
    expect(out2.portfolio).toBe(base.portfolio);
  });
  it("replaces a same-day entry without growing, in either series", () => {
    const out = upsertEntry(base, {
      date: "2026-06-30",
      cash: 9,
      hisa: 9,
      rate: null,
    });
    expect(out.entries).toHaveLength(2);
    expect(out.entries[1].cash).toBe(9);
    const out2 = upsertInvested(base, {
      date: "2026-06-15",
      investedCents: 777,
    });
    expect(out2.invested).toHaveLength(1);
    expect(out2.invested[0].investedCents).toBe(777);
  });
  it("leaves the input untouched", () => {
    const before = JSON.stringify(base);
    upsertEntry(base, { date: "2026-06-20", cash: 2, hisa: 2, rate: null });
    upsertInvested(base, { date: "2026-06-20", investedCents: 5 });
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("importPortfolioCsv", () => {
  const CSV = [
    "Code,Last,Units Held,Net Avg Price AUD,Cost AUD,Market Value AUD,Day Gain AUD,P&L AUD,P&L %",
    "NDQ,50.10,40,45.00,1800.00,2004.00,12.40,204.00,11.3",
    'TOTALS,,,,"1,800.00","2,004.00",12.40,204.00,11.3',
  ].join("\n");
  const OPTS = { today: "2026-07-12", asOf: "12 Jul, 14:30" };

  it("parses the CSV into the snapshot and upserts today's invested cents", () => {
    const out = importPortfolioCsv(cfg2(), CSV, OPTS);
    expect(out).not.toBeNull();
    expect(out?.portfolio?.asOf).toBe("12 Jul, 14:30");
    expect(out?.portfolio?.holdings[0].code).toBe("NDQ");
    expect(out?.invested).toEqual([
      { date: "2026-07-12", investedCents: 200400 },
    ]);
    expect(isFinConfig(out)).toBe(true);
  });
  it("replaces a same-day invested entry and keeps cash untouched", () => {
    const base = cfg2({
      entries: [{ date: "2026-07-01", cash: 50, hisa: 0, rate: null }],
      invested: [{ date: "2026-07-12", investedCents: 1 }],
    });
    const out = importPortfolioCsv(base, CSV, OPTS);
    expect(out?.invested).toEqual([
      { date: "2026-07-12", investedCents: 200400 },
    ]);
    expect(out?.entries).toEqual(base.entries);
  });
  it("is null on an unrecognizable CSV — nothing to seal", () => {
    expect(importPortfolioCsv(cfg2(), "not,a,csv", OPTS)).toBeNull();
    expect(importPortfolioCsv(cfg2(), "", OPTS)).toBeNull();
  });
});

describe("latestEntry / cashAt / investedAt", () => {
  const cfg = cfg2({
    entries: [
      { date: "2026-06-10", cash: 100, hisa: 10, rate: 4 },
      { date: "2026-06-20", cash: 200, hisa: 20, rate: 4.5 },
    ],
    invested: [
      { date: "2026-06-12", investedCents: 100000 },
      { date: "2026-06-22", investedCents: 150000 },
    ],
  });
  const empty = cfg2();

  it("latestEntry is null on empty, else the last (newest) entry", () => {
    expect(latestEntry(empty)).toBeNull();
    expect(latestEntry(cfg)?.date).toBe("2026-06-20");
  });
  it("cashAt is null on empty and before the first entry", () => {
    expect(cashAt(empty, "2026-06-20")).toBeNull();
    expect(cashAt(cfg, "2026-06-01")).toBeNull();
  });
  it("cashAt matches an exact date", () => {
    expect(cashAt(cfg, "2026-06-20")).toEqual({
      cash: 200,
      hisa: 20,
      rate: 4.5,
    });
  });
  it("cashAt between dates picks the earlier entry", () => {
    expect(cashAt(cfg, "2026-06-15")).toEqual({
      cash: 100,
      hisa: 10,
      rate: 4,
    });
  });
  it("investedAt steps: 0 before the first entry, latest ≤ date after", () => {
    expect(investedAt(cfg, "2026-06-11")).toBe(0);
    expect(investedAt(cfg, "2026-06-12")).toBe(100000);
    expect(investedAt(cfg, "2026-06-21")).toBe(100000);
    expect(investedAt(cfg, "2026-06-22")).toBe(150000);
    expect(investedAt(cfg, "2026-07-01")).toBe(150000);
    expect(investedAt(empty, "2026-07-01")).toBe(0);
  });
});

describe("upsertIndexDay", () => {
  const base: SnapIndex = {
    v: 1,
    days: [
      { date: "2026-06-10", readingChapters: 1 },
      { date: "2026-06-30", readingChapters: 3 },
    ],
  };
  it("replaces a same-day entry", () => {
    const out = upsertIndexDay(base, {
      date: "2026-06-30",
      readingChapters: 9,
    });
    expect(out.days).toHaveLength(2);
    expect(out.days[1].readingChapters).toBe(9);
  });
  it("inserts keeping ascending order", () => {
    const out = upsertIndexDay(base, {
      date: "2026-06-20",
      readingChapters: 2,
    });
    expect(out.days.map((d) => d.date)).toEqual([
      "2026-06-10",
      "2026-06-20",
      "2026-06-30",
    ]);
  });
  it("trims to the last SNAP_INDEX_MAX_DAYS when it overflows", () => {
    const days = Array.from({ length: SNAP_INDEX_MAX_DAYS }, (_, i) => ({
      date: dayFromEpoch(i),
      readingChapters: i,
    }));
    const out = upsertIndexDay(
      { v: 1, days },
      { date: dayFromEpoch(SNAP_INDEX_MAX_DAYS), readingChapters: 999 },
    );
    expect(out.days).toHaveLength(SNAP_INDEX_MAX_DAYS);
    expect(out.days[0].date).toBe(dayFromEpoch(1)); // oldest dropped
    expect(out.days.at(-1)?.readingChapters).toBe(999);
  });
});

describe("indexBaseline", () => {
  const days: SnapIndexDay[] = [
    { date: "2026-06-10", readingChapters: 1 },
    { date: "2026-06-17", readingChapters: 4 },
    { date: "2026-06-24", readingChapters: 8 },
  ];
  it("picks the newest day on or before the cutoff (inclusive)", () => {
    expect(indexBaseline(days, "2026-06-20")?.date).toBe("2026-06-17");
    expect(indexBaseline(days, "2026-06-17")?.date).toBe("2026-06-17");
  });
  it("is null when nothing is old enough", () => {
    expect(indexBaseline(days, "2026-06-01")).toBeNull();
  });
});

describe("buildStepSeries", () => {
  const cfg = cfg2({
    entries: [{ date: "2026-06-20", cash: 3317, hisa: 1000, rate: 4.5 }],
    invested: [
      { date: "2026-06-18", investedCents: 400000 },
      { date: "2026-06-25", investedCents: 500000 },
    ],
  });

  it("samples one point per day across the window, stepping both series", () => {
    const series = buildStepSeries(cfg, 10, "2026-06-26");
    expect(series[0].date).toBe("2026-06-18");
    expect(series.at(-1)?.date).toBe("2026-06-26");
    expect(series).toHaveLength(9); // 06-18 … 06-26 inclusive
    // 06-18/06-19: invested only (no cash entry yet).
    expect(series[0].totalCents).toBe(400000);
    expect(series[1].totalCents).toBe(400000);
    // 06-20 onward: + round(3317*100) + round(1000*100).
    expect(series[2].totalCents).toBe(400000 + 331700 + 100000);
    // 06-25 onward: the new invested figure steps in.
    expect(series[7].totalCents).toBe(500000 + 331700 + 100000);
    expect(series[8].totalCents).toBe(500000 + 331700 + 100000);
  });
  it("clips to the window when data reaches back further", () => {
    const series = buildStepSeries(cfg, 3, "2026-06-26");
    expect(series.map((p) => p.date)).toEqual([
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
    ]);
  });
  it("starts at the first data point, never padding zeros before it", () => {
    const series = buildStepSeries(cfg, 30, "2026-06-26");
    expect(series[0].date).toBe("2026-06-18");
  });
  it("is empty for an empty config or a non-positive window", () => {
    expect(buildStepSeries(cfg2(), 30, "2026-06-26")).toEqual([]);
    expect(buildStepSeries(cfg, 0, "2026-06-26")).toEqual([]);
  });
  it("uses cash-only data when no invested entries exist (invested = 0)", () => {
    const cashOnly = cfg2({
      entries: [{ date: "2026-06-24", cash: 10.1, hisa: 0, rate: null }],
    });
    const series = buildStepSeries(cashOnly, 5, "2026-06-26");
    expect(series.map((p) => p.date)).toEqual([
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
    ]);
    expect(series[0].totalCents).toBe(1010); // round(10.1 * 100), no float leak
  });
});

describe("pickBaseline", () => {
  const series: NetWorthPoint[] = [
    { date: "2026-06-12", totalCents: 100 },
    { date: "2026-06-19", totalCents: 200 },
    { date: "2026-06-26", totalCents: 300 },
  ];
  it("picks the newest point exactly `days` old or older", () => {
    // cutoff = 2026-06-26 − 7 = 2026-06-19; the exact-boundary point counts.
    expect(pickBaseline(series, 7, "2026-06-26")?.date).toBe("2026-06-19");
    // cutoff = 2026-06-26 − 10 = 2026-06-16 → newest ≤ is 2026-06-12.
    expect(pickBaseline(series, 10, "2026-06-26")?.date).toBe("2026-06-12");
  });
  it("is null when nothing is old enough or the series is empty", () => {
    expect(pickBaseline(series, 30, "2026-06-26")).toBeNull();
    expect(pickBaseline([], 7, "2026-06-26")).toBeNull();
  });
});

describe("sydneyToday / sydneyDaysAgo", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(sydneyToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sydneyDaysAgo(3)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("shifts a UTC instant onto the right Sydney day (DST-aware)", () => {
    // Winter — AEST (UTC+10): 20:00Z is 06:00 the next day in Sydney.
    expect(sydneyToday(new Date("2026-07-09T20:00:00Z"))).toBe("2026-07-10");
    // Summer — AEDT (UTC+11): 13:30Z is 00:30 the next day in Sydney.
    expect(sydneyToday(new Date("2026-01-15T13:30:00Z"))).toBe("2026-01-16");
  });
  it("treats daysAgo(0) as today and daysAgo(7) as 7 calendar days back", () => {
    const now = new Date(); // one instant, so no midnight race between calls
    const today = sydneyToday(now);
    expect(sydneyDaysAgo(0, now)).toBe(today);
    const [y, m, d] = today.split("-").map(Number);
    const back = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
    expect(sydneyDaysAgo(7, now)).toBe(back);
  });
  it("crosses a month boundary correctly", () => {
    expect(sydneyDaysAgo(7, new Date("2026-07-03T02:00:00Z"))).toBe(
      "2026-06-26",
    );
  });
});
