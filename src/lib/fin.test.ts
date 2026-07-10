import { describe, expect, it } from "vitest";
import {
  buildNetWorthSeries,
  cashAt,
  indexBaseline,
  isFinConfig,
  isSnapBoxPayload,
  isSnapIndex,
  latestEntry,
  pickBaseline,
  SNAP_INDEX_MAX_DAYS,
  sydneyDaysAgo,
  sydneyToday,
  upsertEntry,
  upsertIndexDay,
  type FinConfig,
  type NetWorthPoint,
  type SnapBoxPayload,
  type SnapIndex,
  type SnapIndexDay,
} from "./fin";

// Ascending, unique dates from a fixed epoch — for building oversized/full fixtures.
const dayFromEpoch = (i: number) =>
  new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);

describe("isFinConfig", () => {
  const valid: FinConfig = {
    v: 1,
    entries: [
      { date: "2026-06-20", cash: 100, hisa: 200, rate: 4.5 },
      { date: "2026-06-25", cash: 150, hisa: 0, rate: null },
    ],
  };
  it("accepts a well-formed config, including an empty one", () => {
    expect(isFinConfig(valid)).toBe(true);
    expect(isFinConfig({ v: 1, entries: [] })).toBe(true);
  });
  it("rejects a wrong version or a non-object", () => {
    expect(isFinConfig({ v: 2, entries: [] })).toBe(false);
    expect(isFinConfig(null)).toBe(false);
    expect(isFinConfig("nope")).toBe(false);
    expect(isFinConfig({ v: 1, entries: "no" })).toBe(false);
  });
  it("rejects a bad date shape", () => {
    const bad = (date: unknown) => ({
      v: 1,
      entries: [{ date, cash: 1, hisa: 1, rate: null }],
    });
    expect(isFinConfig(bad("2026-6-1"))).toBe(false);
    expect(isFinConfig(bad("not-a-date"))).toBe(false);
    expect(isFinConfig(bad(20260601))).toBe(false);
  });
  it("rejects negative, NaN, or Infinity numbers", () => {
    const one = (extra: object) => ({
      v: 1,
      entries: [{ date: "2026-06-20", cash: 0, hisa: 0, rate: 0, ...extra }],
    });
    expect(isFinConfig(one({ cash: -1 }))).toBe(false);
    expect(isFinConfig(one({ hisa: NaN }))).toBe(false);
    expect(isFinConfig(one({ cash: Infinity }))).toBe(false);
    expect(isFinConfig(one({ rate: -2 }))).toBe(false);
    expect(isFinConfig(one({ rate: undefined }))).toBe(false); // must be number|null
  });
  it("rejects non-ascending or duplicate dates", () => {
    const seq = (a: string, b: string) => ({
      v: 1,
      entries: [
        { date: a, cash: 1, hisa: 1, rate: null },
        { date: b, cash: 1, hisa: 1, rate: null },
      ],
    });
    expect(isFinConfig(seq("2026-06-25", "2026-06-20"))).toBe(false);
    expect(isFinConfig(seq("2026-06-20", "2026-06-20"))).toBe(false);
  });
  it("rejects an oversized entries array (> 4000)", () => {
    const entries = Array.from({ length: 4001 }, (_, i) => ({
      date: dayFromEpoch(i),
      cash: 0,
      hisa: 0,
      rate: null,
    }));
    expect(isFinConfig({ v: 1, entries })).toBe(false);
  });
});

describe("isSnapBoxPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(
      isSnapBoxPayload({ v: 1, date: "2026-06-20", investedCents: 500000 }),
    ).toBe(true);
    expect(
      isSnapBoxPayload({ v: 1, date: "2026-06-20", investedCents: 0 }),
    ).toBe(true);
  });
  it("rejects a wrong version, a bad date, or a bad cents value", () => {
    expect(
      isSnapBoxPayload({ v: 2, date: "2026-06-20", investedCents: 1 }),
    ).toBe(false);
    expect(isSnapBoxPayload({ v: 1, date: "20260620", investedCents: 1 })).toBe(
      false,
    );
    expect(
      isSnapBoxPayload({ v: 1, date: "2026-06-20", investedCents: -1 }),
    ).toBe(false);
    expect(
      isSnapBoxPayload({ v: 1, date: "2026-06-20", investedCents: 1.5 }),
    ).toBe(false);
    expect(
      isSnapBoxPayload({ v: 1, date: "2026-06-20", investedCents: NaN }),
    ).toBe(false);
    expect(isSnapBoxPayload(null)).toBe(false);
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

describe("upsertEntry", () => {
  const base: FinConfig = {
    v: 1,
    entries: [
      { date: "2026-06-10", cash: 1, hisa: 1, rate: null },
      { date: "2026-06-30", cash: 3, hisa: 3, rate: null },
    ],
  };
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
  it("appends when later than every entry", () => {
    const out = upsertEntry(base, {
      date: "2026-07-05",
      cash: 5,
      hisa: 5,
      rate: null,
    });
    expect(out.entries.at(-1)?.date).toBe("2026-07-05");
  });
  it("replaces a same-day entry without growing", () => {
    const out = upsertEntry(base, {
      date: "2026-06-30",
      cash: 9,
      hisa: 9,
      rate: null,
    });
    expect(out.entries).toHaveLength(2);
    expect(out.entries[1].cash).toBe(9);
  });
  it("leaves the input untouched", () => {
    const before = JSON.stringify(base);
    upsertEntry(base, { date: "2026-06-20", cash: 2, hisa: 2, rate: null });
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("latestEntry / cashAt", () => {
  const cfg: FinConfig = {
    v: 1,
    entries: [
      { date: "2026-06-10", cash: 100, hisa: 10, rate: 4 },
      { date: "2026-06-20", cash: 200, hisa: 20, rate: 4.5 },
    ],
  };
  const empty: FinConfig = { v: 1, entries: [] };

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

describe("buildNetWorthSeries", () => {
  const cfg: FinConfig = {
    v: 1,
    entries: [{ date: "2026-06-20", cash: 3317, hisa: 1000, rate: 4.5 }],
  };
  it("adds invested + cash + hisa in cents, sorted ascending", () => {
    const boxes: SnapBoxPayload[] = [
      { v: 1, date: "2026-06-25", investedCents: 500000 },
      { v: 1, date: "2026-06-18", investedCents: 400000 },
    ];
    const series = buildNetWorthSeries(boxes, cfg);
    expect(series.map((p) => p.date)).toEqual(["2026-06-18", "2026-06-25"]);
    // 2026-06-18 predates the cash entry → invested only.
    expect(series[0].totalCents).toBe(400000);
    // 2026-06-25: 500000 + round(3317*100) + round(1000*100).
    expect(series[1].totalCents).toBe(500000 + 331700 + 100000);
  });
  it("dedupes duplicate dates, last box wins", () => {
    const boxes: SnapBoxPayload[] = [
      { v: 1, date: "2026-06-25", investedCents: 500000 },
      { v: 1, date: "2026-06-25", investedCents: 600000 },
    ];
    const series = buildNetWorthSeries(boxes, cfg);
    expect(series).toHaveLength(1);
    expect(series[0].totalCents).toBe(600000 + 331700 + 100000);
  });
  it("is invested-only when no cash config exists at all", () => {
    const series = buildNetWorthSeries(
      [{ v: 1, date: "2026-06-25", investedCents: 12345 }],
      { v: 1, entries: [] },
    );
    expect(series[0].totalCents).toBe(12345);
  });
  it("rounds fractional dollars to cents (no float leak)", () => {
    const c: FinConfig = {
      v: 1,
      entries: [{ date: "2026-06-20", cash: 10.1, hisa: 0, rate: null }],
    };
    const series = buildNetWorthSeries(
      [{ v: 1, date: "2026-06-21", investedCents: 0 }],
      c,
    );
    expect(series[0].totalCents).toBe(1010); // round(10.1 * 100), not 1009
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
