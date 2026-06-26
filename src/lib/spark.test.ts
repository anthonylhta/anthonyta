import { describe, expect, it } from "vitest";
import { sparkGeometry } from "./spark";

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
