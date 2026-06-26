import { describe, expect, it } from "vitest";
import { dailyCounts, dailyDeltas, toLevels } from "./activity";

describe("toLevels", () => {
  it("buckets to 0–4 scaled to the busiest day", () => {
    expect(toLevels([0, 1, 2, 3, 4])).toEqual([0, 1, 2, 3, 4]);
  });
  it("keeps an all-zero series flat", () => {
    expect(toLevels([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("dailyCounts", () => {
  it("counts items per day over the trailing window, oldest → newest", () => {
    const dates = [
      "2026-06-26T09:00:00Z",
      "2026-06-26T18:00:00Z",
      "2026-06-25T12:00:00Z",
    ];
    expect(dailyCounts(dates, 3, "2026-06-26")).toEqual([0, 1, 2]);
  });
  it("returns all zeros when nothing falls in the window", () => {
    expect(dailyCounts(["2025-01-01"], 3, "2026-06-26")).toEqual([0, 0, 0]);
  });
});

describe("dailyDeltas", () => {
  it("places the rise between snapshots on the later day", () => {
    const series = [
      { date: "2026-06-24", value: 100 },
      { date: "2026-06-26", value: 108 },
    ];
    expect(dailyDeltas(series, 3, "2026-06-26")).toEqual([0, 0, 8]);
  });
  it("clamps a drop to zero", () => {
    const series = [
      { date: "2026-06-25", value: 50 },
      { date: "2026-06-26", value: 40 },
    ];
    expect(dailyDeltas(series, 2, "2026-06-26")).toEqual([0, 0]);
  });
});
