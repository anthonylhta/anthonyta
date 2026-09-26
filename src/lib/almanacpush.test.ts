import { describe, expect, it } from "vitest";
import { ALMANAC_NOTICE_DAYS, checkAlmanacWindows } from "./almanacpush";

describe("checkAlmanacWindows", () => {
  const jlpt = { name: "JLPT registration", from: "03-01", to: "03-20" };
  const fair = { name: "the book fair", from: "2026-10-09", to: "2026-10-12" };
  const summer = { name: "summer swims", from: "12-01", to: "02-28" };

  it("says a window opens today", () => {
    expect(checkAlmanacWindows([jlpt], "2027-03-01", undefined)).toEqual({
      send: true,
      body: "JLPT registration opens today",
      episode: "2027-03-01",
      reason: "opens",
    });
  });

  it("says a window opens in a week", () => {
    const r = checkAlmanacWindows([jlpt], "2027-02-22", undefined);
    expect(r.send).toBe(true);
    expect(r.body).toBe(
      `JLPT registration opens in ${ALMANAC_NOTICE_DAYS} days`,
    );
    expect(r.body).toBe("JLPT registration opens in 7 days");
  });

  it("folds both days into one line, in the file's order", () => {
    const both = checkAlmanacWindows(
      [fair, { ...jlpt, from: "10-02", to: "10-05" }],
      "2026-10-02",
      undefined,
    );
    expect(both.body).toBe(
      "the book fair opens in 7 days · JLPT registration opens today",
    );
  });

  it("stays quiet on every other day, keeping the marker", () => {
    for (const day of ["2027-02-21", "2027-02-23", "2027-03-02", "2026-09-25"])
      expect(checkAlmanacWindows([jlpt], day, "2026-08-01")).toEqual({
        send: false,
        body: "",
        episode: "2026-08-01",
        reason: "quiet",
      });
    expect(checkAlmanacWindows([], "2027-03-01", undefined).send).toBe(false);
  });

  it("never says it twice on one day", () => {
    expect(checkAlmanacWindows([jlpt], "2027-03-01", "2027-03-01")).toEqual({
      send: false,
      body: "",
      episode: "2027-03-01",
      reason: "notified",
    });
    // The next day is a new day — and here, a quiet one.
    expect(checkAlmanacWindows([jlpt], "2027-03-02", "2027-03-01").reason).toBe(
      "quiet",
    );
  });

  it("reads a recurring window across the new year", () => {
    expect(checkAlmanacWindows([summer], "2026-11-24", undefined).body).toBe(
      "summer swims opens in 7 days",
    );
    expect(checkAlmanacWindows([summer], "2026-12-01", undefined).body).toBe(
      "summer swims opens today",
    );
    // A window opening on New Year's Day is a week out on Christmas Day.
    const ny = { name: "the new year swim", from: "01-01", to: "01-01" };
    expect(checkAlmanacWindows([ny], "2026-12-25", undefined).body).toBe(
      "the new year swim opens in 7 days",
    );
    expect(checkAlmanacWindows([ny], "2027-01-01", undefined).body).toBe(
      "the new year swim opens today",
    );
  });

  it("reads a one-off by its own date, and never once it has opened", () => {
    expect(checkAlmanacWindows([fair], "2026-10-02", undefined).body).toBe(
      "the book fair opens in 7 days",
    );
    expect(checkAlmanacWindows([fair], "2026-10-09", undefined).body).toBe(
      "the book fair opens today",
    );
    expect(checkAlmanacWindows([fair], "2027-10-02", undefined).send).toBe(
      false,
    );
  });
});
