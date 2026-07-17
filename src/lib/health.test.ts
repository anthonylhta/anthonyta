import { describe, expect, it } from "vitest";
import { HEALTH_TARGETS, SLOW_MS, classifyHealth } from "./health";

describe("HEALTH_TARGETS", () => {
  it("uses unique keys and https urls", () => {
    const keys = HEALTH_TARGETS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of HEALTH_TARGETS) expect(t.url).toMatch(/^https:\/\//);
  });
});

describe("classifyHealth", () => {
  it("2xx and quick is ok", () => {
    expect(classifyHealth(true, 120)).toBe("ok");
    expect(classifyHealth(true, SLOW_MS - 1)).toBe("ok");
  });

  it("2xx but slow is degraded", () => {
    expect(classifyHealth(true, SLOW_MS)).toBe("slow");
    expect(classifyHealth(true, 9000)).toBe("slow");
  });

  it("anything unreachable is down", () => {
    expect(classifyHealth(false, 200)).toBe("down");
    expect(classifyHealth(false, null)).toBe("down");
  });
});
