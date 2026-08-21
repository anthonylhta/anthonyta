import { describe, expect, it } from "vitest";
import {
  isSleepIngest,
  MAX_SLEEP_BYTES,
  parseSleepStore,
  sampleSleep,
  serializeSleepStore,
  SLEEP_HISTORY_CAP,
  sleepForNight,
  upsertNight,
  weekAverage,
} from "./sleep";

describe("isSleepIngest", () => {
  it("accepts a bare duration", () => {
    expect(isSleepIngest({ minutes: 0 })).toBe(true);
    expect(isSleepIngest({ minutes: 432 })).toBe(true);
  });

  it("accepts a duration with a valid date", () => {
    expect(isSleepIngest({ minutes: 432, date: "2026-08-20" })).toBe(true);
  });

  it("accepts a full day but not a minute more", () => {
    expect(isSleepIngest({ minutes: 1440 })).toBe(true);
    expect(isSleepIngest({ minutes: 1441 })).toBe(false);
  });

  it("rejects non-integer, negative, or absurd durations", () => {
    expect(isSleepIngest({ minutes: 432.5 })).toBe(false);
    expect(isSleepIngest({ minutes: -1 })).toBe(false);
    expect(isSleepIngest({ minutes: 10_000 })).toBe(false);
    expect(isSleepIngest({ minutes: Number.NaN })).toBe(false);
    expect(isSleepIngest({ minutes: "432" })).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(isSleepIngest({ minutes: 400, date: "20-08-2026" })).toBe(false);
    expect(isSleepIngest({ minutes: 400, date: "2026/08/20" })).toBe(false);
    expect(isSleepIngest({ minutes: 400, date: 20260820 })).toBe(false);
  });

  it("rejects non-objects and missing minutes", () => {
    expect(isSleepIngest(null)).toBe(false);
    expect(isSleepIngest("432")).toBe(false);
    expect(isSleepIngest({})).toBe(false);
    expect(isSleepIngest({ date: "2026-08-20" })).toBe(false);
  });
});

describe("parseSleepStore", () => {
  it("round-trips a serialized store", () => {
    const data = { nights: { "2026-08-19": 401, "2026-08-20": 432 } };
    expect(parseSleepStore(serializeSleepStore(data))).toEqual(data);
  });

  it("reads a versioned or bare blob the same way", () => {
    expect(parseSleepStore('{"v":1,"nights":{"2026-08-20":432}}')).toEqual({
      nights: { "2026-08-20": 432 },
    });
    expect(parseSleepStore('{"nights":{"2026-08-20":432}}')).toEqual({
      nights: { "2026-08-20": 432 },
    });
  });

  it("drops malformed dates and durations, never throws", () => {
    expect(
      parseSleepStore(
        '{"nights":{"2026-08-20":432,"bad-date":400,"2026-08-21":-5,"2026-08-22":432.5,"2026-08-23":"x","2026-08-24":1441}}',
      ),
    ).toEqual({ nights: { "2026-08-20": 432 } });
  });

  it("returns an empty store on junk", () => {
    expect(parseSleepStore("not json")).toEqual({ nights: {} });
    expect(parseSleepStore("null")).toEqual({ nights: {} });
    expect(parseSleepStore("[]")).toEqual({ nights: {} });
    expect(parseSleepStore('{"nights":42}')).toEqual({ nights: {} });
  });
});

describe("upsertNight", () => {
  it("adds a new night", () => {
    const r = upsertNight({ nights: { "2026-08-19": 401 } }, "2026-08-20", 432);
    expect(r.nights).toEqual({ "2026-08-19": 401, "2026-08-20": 432 });
  });

  it("overwrites the same night (last write wins)", () => {
    const r = upsertNight({ nights: { "2026-08-20": 90 } }, "2026-08-20", 432);
    expect(r.nights).toEqual({ "2026-08-20": 432 });
  });

  it("prunes to the most recent cap nights", () => {
    let data = { nights: {} as Record<string, number> };
    // 130 consecutive nights, well past the 120 cap.
    for (let i = 0; i < 130; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      data = upsertNight(data, d, 300 + i);
    }
    const keys = Object.keys(data.nights).sort();
    expect(keys.length).toBe(SLEEP_HISTORY_CAP);
    // The oldest 10 fell off; the newest survived.
    expect(keys[0]).toBe("2026-01-11");
    expect(data.nights[keys[keys.length - 1]]).toBe(429);
  });

  it("does not mutate the input", () => {
    const input = { nights: { "2026-08-19": 401 } };
    upsertNight(input, "2026-08-20", 432);
    expect(input.nights).toEqual({ "2026-08-19": 401 });
  });
});

describe("sleepForNight", () => {
  const data = { nights: { "2026-08-20": 432, "2026-08-18": 0 } };
  it("returns the minutes for a recorded night", () => {
    expect(sleepForNight(data, "2026-08-20")).toBe(432);
  });
  it("distinguishes a recorded zero from a missing night", () => {
    expect(sleepForNight(data, "2026-08-18")).toBe(0);
    expect(sleepForNight(data, "2026-08-19")).toBeNull();
  });
});

describe("weekAverage", () => {
  it("is null when nothing in the window was recorded", () => {
    expect(weekAverage({ nights: {} }, "2026-08-20")).toBeNull();
    // A night just outside the seven is not in the window.
    expect(
      weekAverage({ nights: { "2026-08-13": 480 } }, "2026-08-20"),
    ).toBeNull();
  });

  it("averages the recorded nights only, never the gaps", () => {
    const data = {
      nights: { "2026-08-20": 480, "2026-08-19": 400, "2026-08-14": 320 },
    };
    // Three recorded nights in the window → 1200/3, NOT 1200/7.
    expect(weekAverage(data, "2026-08-20")).toBe(400);
  });

  it("averages a full week and rounds", () => {
    const nights: Record<string, number> = {};
    for (let d = 14; d <= 20; d++) nights[`2026-08-${d}`] = d * 30;
    // 420..600 in thirties → 510 exactly.
    expect(weekAverage({ nights }, "2026-08-20")).toBe(510);
    nights["2026-08-20"] = 601;
    expect(weekAverage({ nights }, "2026-08-20")).toBe(510); // 510.14 → 510
  });

  it("ignores nights after today", () => {
    const data = { nights: { "2026-08-21": 60, "2026-08-20": 432 } };
    expect(weekAverage(data, "2026-08-20")).toBe(432);
  });

  it("crosses a month boundary correctly", () => {
    const data = { nights: { "2026-08-01": 400, "2026-07-31": 500 } };
    expect(weekAverage(data, "2026-08-01")).toBe(450);
  });
});

describe("sampleSleep", () => {
  it("ends exactly on today and covers a fortnight", () => {
    const s = sampleSleep("2026-08-20");
    expect(sleepForNight(s, "2026-08-20")).toBe(425);
    expect(Object.keys(s.nights).length).toBe(14);
    expect(sleepForNight(s, "2026-08-07")).toBe(430); // 14 nights earlier
    expect(sleepForNight(s, "2026-07-31")).toBeNull(); // before the window
  });

  it("is deterministic and plausible for every night", () => {
    expect(sampleSleep("2026-08-20")).toEqual(sampleSleep("2026-08-20"));
    for (const minutes of Object.values(sampleSleep("2026-08-20").nights)) {
      expect(minutes).toBeGreaterThanOrEqual(360);
      expect(minutes).toBeLessThanOrEqual(540);
    }
  });
});

describe("MAX_SLEEP_BYTES", () => {
  it("is a tiny cap — the body is one small object", () => {
    expect(MAX_SLEEP_BYTES).toBeLessThanOrEqual(4096);
  });
});
