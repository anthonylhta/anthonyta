import { describe, expect, it } from "vitest";
import { pct, progressBar } from "./format";

describe("pct", () => {
  it("computes whole percent", () => {
    expect(pct(83, 100)).toBe(83);
    expect(pct(1, 3)).toBe(33);
  });
  it("guards a non-positive max", () => {
    expect(pct(5, 0)).toBe(0);
    expect(pct(5, -2)).toBe(0);
  });
});

describe("progressBar", () => {
  it("fills proportionally to the width", () => {
    expect(progressBar(50, 100, 10)).toBe("▓▓▓▓▓░░░░░");
    expect(progressBar(100, 100, 4)).toBe("▓▓▓▓");
    expect(progressBar(0, 100, 4)).toBe("░░░░");
  });
  it("never overflows or underflows the width", () => {
    expect(progressBar(999, 100, 5)).toBe("▓▓▓▓▓");
    expect(progressBar(-10, 100, 5)).toBe("░░░░░");
    expect(progressBar(5, 0, 5)).toBe("░░░░░");
  });
});
