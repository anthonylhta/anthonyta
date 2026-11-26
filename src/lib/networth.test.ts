import { describe, expect, it } from "vitest";
import type { FinConfig } from "./fin";
import {
  buildSplitSeries,
  chartDay,
  chartGeometry,
  compactAud,
  niceStep,
  rangeSlice,
  type SplitPoint,
} from "./networth";

const cfg = (partial: Partial<FinConfig> = {}): FinConfig => ({
  v: 2,
  entries: [],
  invested: [],
  portfolio: null,
  ...partial,
});

const pt = (
  date: string,
  invested: number,
  savings: number,
  debt = 0,
): SplitPoint => ({
  date,
  investedCents: invested,
  hisaCents: savings,
  cashCents: 0,
  savingsCents: savings,
  totalCents: invested + savings,
  debtCents: debt,
  netCents: invested + savings - debt,
});

describe("buildSplitSeries", () => {
  it("splits each day into investments and savings from the step functions", () => {
    const s = buildSplitSeries(
      cfg({
        entries: [{ date: "2026-11-01", cash: 100, hisa: 900, rate: null }],
        invested: [
          { date: "2026-11-02", investedCents: 50000 },
          { date: "2026-11-04", investedCents: 60000 },
        ],
      }),
      "2026-11-04",
    );
    expect(s.map((p) => p.date)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
    expect(s[0]).toEqual({
      date: "2026-11-01",
      investedCents: 0,
      hisaCents: 90000,
      cashCents: 10000,
      savingsCents: 100000,
      totalCents: 100000,
      debtCents: 0,
      netCents: 100000,
    });
    expect(s[3].investedCents).toBe(60000);
    expect(s[3].totalCents).toBe(160000);
  });

  it("takes debts off the assets to give the net", () => {
    const s = buildSplitSeries(
      cfg({
        entries: [{ date: "2026-11-01", cash: 0, hisa: 1000, rate: null }],
        debts: [
          {
            name: "loan a",
            balances: [{ date: "2026-11-02", balanceCents: 40000 }],
          },
        ],
      }),
      "2026-11-03",
    );
    expect(s.map((p) => p.netCents)).toEqual([100000, 60000, 60000]);
    expect(s[2].debtCents).toBe(40000);
    expect(s[2].totalCents).toBe(100000);
  });

  it("is empty with no data, or data only after today", () => {
    expect(buildSplitSeries(cfg(), "2026-11-04")).toEqual([]);
    expect(
      buildSplitSeries(
        cfg({ invested: [{ date: "2026-12-01", investedCents: 1 }] }),
        "2026-11-04",
      ),
    ).toEqual([]);
  });
});

describe("rangeSlice", () => {
  const series = Array.from({ length: 120 }, (_, i) =>
    pt(new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), i, 0),
  );

  it("keeps the trailing window ending on the last day", () => {
    const m = rangeSlice(series, "1M");
    expect(m.at(-1)?.date).toBe(series.at(-1)?.date);
    expect(m).toHaveLength(31); // 30 days back, both ends included
    expect(rangeSlice(series, "3M")).toHaveLength(92);
    expect(rangeSlice(series, "ALL")).toBe(series);
  });

  it("falls back to everything when the window holds under two points", () => {
    const two = [pt("2026-01-01", 1, 0), pt("2026-11-01", 2, 0)];
    expect(rangeSlice(two, "1M")).toBe(two);
  });
});

describe("niceStep / compactAud / chartDay", () => {
  it("rounds a raw step up to 1, 2 or 5 × 10ⁿ", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(380000)).toBe(500000);
    expect(niceStep(910000)).toBe(1000000);
    expect(niceStep(0)).toBe(1);
  });

  it("labels the axis in thousands", () => {
    expect(compactAud(4000000)).toBe("$40k");
    expect(compactAud(4250000)).toBe("$42.5k");
    expect(compactAud(50000)).toBe("$500");
    expect(compactAud(0)).toBe("$0");
    expect(compactAud(-1000000)).toBe("−$10k");
    expect(compactAud(-50000)).toBe("−$500");
  });

  it("writes a day as '26 nov'", () => {
    expect(chartDay("2026-11-26")).toBe("26 nov");
    expect(chartDay("2026-07-01")).toBe("1 jul");
  });
});

describe("chartGeometry", () => {
  const pts = [
    pt("2026-11-01", 1000000, 1000000),
    pt("2026-11-02", 1100000, 1000000),
    pt("2026-11-03", 1300000, 1100000),
  ];

  it("spans the plot left of the gutter, first point at x 0", () => {
    const g = chartGeometry(pts, "line", 340, 200, 40);
    expect(g.points.map((p) => p.x)).toEqual([0, 150, 300]);
    expect(g.line.startsWith("M0,")).toBe(true);
    // a rising total climbs the screen
    expect(g.points[2].y).toBeLessThan(g.points[0].y);
    expect(g.baseY).toBe(g.points[0].y);
  });

  it("fits the line to the data but starts the stack at zero", () => {
    const line = chartGeometry(pts, "line", 340, 200, 40);
    const split = chartGeometry(pts, "split", 340, 200, 40);
    // line mode: the lowest total sits near the floor, not at the top
    expect(line.points[0].y).toBeGreaterThan(150);
    // split mode: a $0 gridline exists, at the floor
    expect(split.ticks[0]).toEqual({ y: split.floor, label: "$0" });
    expect(split.invested.endsWith("Z")).toBe(true);
    expect(split.savings.endsWith("Z")).toBe(true);
  });

  it("draws the net, and lets the split axis dip below $0 for a debt", () => {
    const owing = [
      pt("2026-11-01", 1000000, 0, 2500000),
      pt("2026-11-02", 2000000, 0, 2500000),
    ];
    const line = chartGeometry(owing, "line", 340, 200, 40);
    // the net rises −15k → −5k: the line climbs
    expect(line.points[1].y).toBeLessThan(line.points[0].y);
    const split = chartGeometry(owing, "split", 340, 200, 40);
    expect(split.ticks[0].label.startsWith("−")).toBe(true);
    // the net (−5k) sits below the $0 gridline
    const zero = split.ticks.find((t) => t.label === "$0")!;
    expect(split.points[1].y).toBeGreaterThan(zero.y);
    expect(split.assets.startsWith("M0,")).toBe(true);
  });

  it("gives evenly spaced gridlines inside the plot", () => {
    const g = chartGeometry(pts, "split", 340, 200, 40);
    expect(g.ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of g.ticks) {
      expect(t.y).toBeLessThanOrEqual(g.floor);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("draws a flat series without dividing by zero", () => {
    const flat = [pt("2026-11-01", 100, 0), pt("2026-11-02", 100, 0)];
    const g = chartGeometry(flat, "line", 340, 200, 40);
    expect(g.points.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});
