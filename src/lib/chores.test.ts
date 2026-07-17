import { describe, expect, it } from "vitest";
import { choreState, daysSince } from "./chores";

const NOW = new Date("2026-07-17T09:00:00+10:00");

describe("daysSince", () => {
  it("whole days, floored, never negative", () => {
    expect(daysSince("2026-07-17T08:00:00+10:00", NOW)).toBe(0);
    expect(daysSince("2026-07-14T09:00:00+10:00", NOW)).toBe(3);
    // Bare dates parse as UTC midnight (see the lib doc): 07-10T00:00Z →
    // 07-16T23:00Z is 6.96 days, floored to 6.
    expect(daysSince("2026-07-10", NOW)).toBe(6);
    expect(daysSince("2026-07-18T09:00:00+10:00", NOW)).toBe(0);
  });

  it("null on missing or unparseable", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("not a date", NOW)).toBeNull();
  });
});

describe("choreState", () => {
  it("ok under the cadence", () => {
    expect(choreState("2026-07-14T09:00:00+10:00", 7, NOW)).toEqual({
      ageDays: 3,
      status: "ok",
    });
  });

  it("due at the cadence, overdue at twice it", () => {
    expect(choreState("2026-07-09T09:00:00+10:00", 7, NOW).status).toBe("due");
    expect(choreState("2026-07-02T09:00:00+10:00", 7, NOW).status).toBe(
      "overdue",
    );
  });

  it("unknown with no record", () => {
    expect(choreState(null, 7, NOW)).toEqual({
      ageDays: null,
      status: "unknown",
    });
  });
});
