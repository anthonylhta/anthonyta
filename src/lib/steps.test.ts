import { describe, expect, it } from "vitest";
import {
  commas,
  isStepsIngest,
  MAX_STEPS_BYTES,
  parseStepsStore,
  sampleSteps,
  serializeStepsStore,
  stepsForDay,
  STEPS_HISTORY_CAP,
  trailingSeries,
  upsertDay,
} from "./steps";

describe("isStepsIngest", () => {
  it("accepts a bare count", () => {
    expect(isStepsIngest({ steps: 0 })).toBe(true);
    expect(isStepsIngest({ steps: 6240 })).toBe(true);
  });

  it("accepts a count with a valid date", () => {
    expect(isStepsIngest({ steps: 6240, date: "2026-07-20" })).toBe(true);
  });

  it("rejects non-integer, negative, or absurd counts", () => {
    expect(isStepsIngest({ steps: 12.5 })).toBe(false);
    expect(isStepsIngest({ steps: -1 })).toBe(false);
    expect(isStepsIngest({ steps: 500_000 })).toBe(false);
    expect(isStepsIngest({ steps: Number.NaN })).toBe(false);
    expect(isStepsIngest({ steps: "6240" })).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(isStepsIngest({ steps: 10, date: "20-07-2026" })).toBe(false);
    expect(isStepsIngest({ steps: 10, date: "2026/07/20" })).toBe(false);
    expect(isStepsIngest({ steps: 10, date: 20260720 })).toBe(false);
  });

  it("rejects non-objects and missing steps", () => {
    expect(isStepsIngest(null)).toBe(false);
    expect(isStepsIngest("6240")).toBe(false);
    expect(isStepsIngest({})).toBe(false);
    expect(isStepsIngest({ date: "2026-07-20" })).toBe(false);
  });
});

describe("parseStepsStore", () => {
  it("round-trips a serialized store", () => {
    const data = { days: { "2026-07-19": 6100, "2026-07-20": 8200 } };
    expect(parseStepsStore(serializeStepsStore(data))).toEqual(data);
  });

  it("reads a versioned or bare blob the same way", () => {
    expect(parseStepsStore('{"v":1,"days":{"2026-07-20":8200}}')).toEqual({
      days: { "2026-07-20": 8200 },
    });
    expect(parseStepsStore('{"days":{"2026-07-20":8200}}')).toEqual({
      days: { "2026-07-20": 8200 },
    });
  });

  it("drops malformed dates and counts, never throws", () => {
    expect(
      parseStepsStore(
        '{"days":{"2026-07-20":8200,"bad-date":10,"2026-07-21":-5,"2026-07-22":12.5,"2026-07-23":"x"}}',
      ),
    ).toEqual({ days: { "2026-07-20": 8200 } });
  });

  it("returns an empty store on junk", () => {
    expect(parseStepsStore("not json")).toEqual({ days: {} });
    expect(parseStepsStore("null")).toEqual({ days: {} });
    expect(parseStepsStore("[]")).toEqual({ days: {} });
    expect(parseStepsStore('{"days":42}')).toEqual({ days: {} });
  });
});

describe("upsertDay", () => {
  it("adds a new day", () => {
    const r = upsertDay({ days: { "2026-07-19": 6100 } }, "2026-07-20", 8200);
    expect(r.days).toEqual({ "2026-07-19": 6100, "2026-07-20": 8200 });
  });

  it("overwrites the same day (last write wins)", () => {
    const r = upsertDay({ days: { "2026-07-20": 4000 } }, "2026-07-20", 8200);
    expect(r.days).toEqual({ "2026-07-20": 8200 });
  });

  it("prunes to the most recent cap days", () => {
    let data = { days: {} as Record<string, number> };
    // 130 consecutive days, well past the 120 cap.
    for (let i = 0; i < 130; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      data = upsertDay(data, d, i);
    }
    const keys = Object.keys(data.days).sort();
    expect(keys.length).toBe(STEPS_HISTORY_CAP);
    // The oldest 10 fell off; the newest survived.
    expect(keys[0]).toBe("2026-01-11");
    expect(data.days[keys[keys.length - 1]]).toBe(129);
  });

  it("does not mutate the input", () => {
    const input = { days: { "2026-07-19": 6100 } };
    upsertDay(input, "2026-07-20", 8200);
    expect(input.days).toEqual({ "2026-07-19": 6100 });
  });
});

describe("stepsForDay", () => {
  const data = { days: { "2026-07-20": 8200, "2026-07-18": 0 } };
  it("returns the count for a recorded day", () => {
    expect(stepsForDay(data, "2026-07-20")).toBe(8200);
  });
  it("distinguishes a recorded zero from a missing day", () => {
    expect(stepsForDay(data, "2026-07-18")).toBe(0);
    expect(stepsForDay(data, "2026-07-19")).toBeNull();
  });
});

describe("trailingSeries", () => {
  it("returns n days ending at today, oldest → newest, gaps as 0", () => {
    const data = { days: { "2026-07-20": 8200, "2026-07-18": 6100 } };
    expect(trailingSeries(data, 4, "2026-07-20")).toEqual([0, 6100, 0, 8200]);
  });

  it("crosses a month boundary correctly", () => {
    const data = { days: { "2026-08-01": 5000, "2026-07-31": 4000 } };
    expect(trailingSeries(data, 2, "2026-08-01")).toEqual([4000, 5000]);
  });
});

describe("commas", () => {
  it("groups thousands", () => {
    expect(commas(0)).toBe("0");
    expect(commas(999)).toBe("999");
    expect(commas(6240)).toBe("6,240");
    expect(commas(15800)).toBe("15,800");
    expect(commas(1234567)).toBe("1,234,567");
  });
});

describe("sampleSteps", () => {
  it("ends exactly on today and covers a fortnight", () => {
    const s = sampleSteps("2026-07-20");
    expect(stepsForDay(s, "2026-07-20")).toBe(7000);
    expect(Object.keys(s.days).length).toBe(14);
    expect(stepsForDay(s, "2026-07-07")).toBe(8200); // 14 days earlier
    expect(stepsForDay(s, "2026-06-30")).toBeNull(); // before the window
  });
});

describe("MAX_STEPS_BYTES", () => {
  it("is a tiny cap — the body is one small object", () => {
    expect(MAX_STEPS_BYTES).toBeLessThanOrEqual(4096);
  });
});
