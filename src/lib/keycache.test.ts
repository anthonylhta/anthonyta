import { describe, expect, it } from "vitest";
import { IDLE_LOCK_MS, isIdleStale } from "./keycache";

const NOW = 1_700_000_000_000;

describe("isIdleStale", () => {
  it("a just-touched stamp is fresh", () => {
    expect(isIdleStale(NOW, NOW)).toBe(false);
  });

  it("fresh up to the boundary, stale one ms past it", () => {
    expect(isIdleStale(NOW - IDLE_LOCK_MS, NOW)).toBe(false);
    expect(isIdleStale(NOW - IDLE_LOCK_MS - 1, NOW)).toBe(true);
  });

  it("a long-idle stamp is stale", () => {
    expect(isIdleStale(NOW - 30 * 24 * 60 * 60 * 1000, NOW)).toBe(true);
  });

  it("non-finite stamps count as stale — a corrupted stamp fails toward locked", () => {
    expect(isIdleStale(NaN, NOW)).toBe(true);
    expect(isIdleStale(Infinity, NOW)).toBe(true);
    expect(isIdleStale(-Infinity, NOW)).toBe(true);
  });

  it("a future stamp (clock skew/rollback) is NOT stale", () => {
    expect(isIdleStale(NOW + 60_000, NOW)).toBe(false);
  });
});
