import { describe, expect, it } from "vitest";
import { scrubIndex, sparkGeometry } from "./spark";

describe("sparkGeometry", () => {
  it("returns empty geometry for no values", () => {
    expect(sparkGeometry([], 100, 20)).toEqual({
      line: "",
      area: "",
      points: [],
    });
  });

  it("centers a single point horizontally", () => {
    const { points } = sparkGeometry([42], 100, 20);
    expect(points).toEqual([{ x: 50, y: 10 }]);
  });

  it("draws a flat series as a centered horizontal line", () => {
    const { points } = sparkGeometry([50, 50, 50], 100, 20);
    expect(points.every((p) => p.y === 10)).toBe(true);
    expect(points.map((p) => p.x)).toEqual([0, 50, 100]);
  });

  it("rises with the value (higher value → smaller y)", () => {
    const { points } = sparkGeometry([100, 200], 100, 20, 2);
    // x spans the full width; the low value sits at the bottom, the high at the top
    expect(points[0]).toEqual({ x: 0, y: 18 });
    expect(points[1]).toEqual({ x: 100, y: 2 });
    expect(points[1].y).toBeLessThan(points[0].y);
  });

  it("keeps every point inside the padded box", () => {
    const { points } = sparkGeometry([3, 1, 4, 1, 5, 9, 2, 6], 320, 48, 3);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(320);
      expect(p.y).toBeGreaterThanOrEqual(3);
      expect(p.y).toBeLessThanOrEqual(45);
    }
  });

  it("closes the area path down to the baseline", () => {
    const { area } = sparkGeometry([1, 2], 100, 20, 2);
    expect(area.startsWith("M ")).toBe(true);
    expect(area.endsWith("Z")).toBe(true);
    expect(area).toContain("L 100,20"); // drop to the baseline at full height
  });
});

describe("scrubIndex", () => {
  it("maps a pointer across the plot onto the nearest evenly spaced point", () => {
    // 5 points over 100px sit at 0, 25, 50, 75, 100.
    expect(scrubIndex(0, 100, 5)).toBe(0);
    expect(scrubIndex(12, 100, 5)).toBe(0);
    expect(scrubIndex(13, 100, 5)).toBe(1);
    expect(scrubIndex(50, 100, 5)).toBe(2);
    expect(scrubIndex(88, 100, 5)).toBe(4);
    expect(scrubIndex(100, 100, 5)).toBe(4);
  });

  it("clamps a drag past either edge to the end points", () => {
    expect(scrubIndex(-40, 100, 5)).toBe(0);
    expect(scrubIndex(999, 100, 5)).toBe(4);
  });

  it("is 0 for a single point and -1 for none", () => {
    expect(scrubIndex(70, 100, 1)).toBe(0);
    expect(scrubIndex(70, 100, 0)).toBe(-1);
    // A zero-width plot (not laid out yet) parks on the first point rather
    // than dividing by zero.
    expect(scrubIndex(10, 0, 5)).toBe(0);
  });
});
