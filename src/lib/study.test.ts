import { describe, expect, it } from "vitest";
import {
  addStudy,
  EMPTY_STUDY,
  lastStudyDay,
  MAX_STUDY_ENTRIES,
  MAX_STUDY_SOURCE,
  normalizeStudy,
  studyDays,
  studyDaysIn,
  studyDaysTrailing,
  type StudyConfig,
} from "./study";

const article = { date: "2026-09-24", source: "東洋経済 article", minutes: 20 };
const anki = { date: "2026-09-24", source: "anki" };
const earlier = { date: "2026-09-20", source: "NHK news web" };

const log = (...entries: StudyConfig["entries"]): StudyConfig => ({
  v: 1,
  entries,
});

describe("normalizeStudy", () => {
  it("accepts an empty log and a full one", () => {
    expect(normalizeStudy({ v: 1, entries: [] })).toEqual(EMPTY_STUDY);
    const full = { v: 1, seq: 3, entries: [earlier, article, anki] };
    expect(normalizeStudy(full)).toEqual(full);
  });

  it("trims the source and drops unknown keys", () => {
    expect(
      normalizeStudy({
        v: 1,
        entries: [{ ...anki, source: "  anki  ", smuggled: 1 }],
        smuggled: true,
      }),
    ).toEqual(log(anki));
  });

  it("sorts by day, keeping same-day rows in the order logged", () => {
    expect(
      normalizeStudy({ v: 1, entries: [article, earlier, anki] })?.entries,
    ).toEqual([earlier, article, anki]);
  });

  it("rejects a wrong frame, a bad seq and any malformed row", () => {
    expect(normalizeStudy(null)).toBeNull();
    expect(normalizeStudy({ v: 2, entries: [] })).toBeNull();
    expect(normalizeStudy({ v: 1 })).toBeNull();
    expect(normalizeStudy({ v: 1, seq: -1, entries: [] })).toBeNull();
    const bad = [
      { ...anki, date: "24 Sep" },
      { ...anki, source: "   " },
      { ...anki, source: "x".repeat(MAX_STUDY_SOURCE + 1) },
      { ...anki, minutes: 0 },
      { ...anki, minutes: 601 },
      { ...anki, minutes: 12.5 },
      { ...anki, minutes: "20" },
    ];
    for (const row of bad)
      expect(normalizeStudy({ v: 1, entries: [earlier, row] })).toBeNull();
  });

  it("refuses a log past its cap", () => {
    expect(
      normalizeStudy({
        v: 1,
        entries: Array.from({ length: MAX_STUDY_ENTRIES + 1 }, () => anki),
      }),
    ).toBeNull();
  });
});

describe("addStudy", () => {
  it("appends, several a day", () => {
    const one = addStudy(EMPTY_STUDY, article);
    expect(addStudy(one, anki)).toEqual(log(article, anki));
  });

  it("slots a back-dated row after its own day", () => {
    const cfg = log(earlier, article);
    const mid = { date: "2026-09-22", source: "a graded reader" };
    expect(addStudy(cfg, mid).entries).toEqual([earlier, mid, article]);
    const same = { date: "2026-09-20", source: "anki" };
    expect(addStudy(cfg, same).entries).toEqual([earlier, same, article]);
  });

  it("returns the log unchanged for a malformed row or a full log", () => {
    const cfg = log(article);
    expect(addStudy(cfg, { ...anki, source: "" })).toBe(cfg);
    expect(addStudy(cfg, { ...anki, minutes: 900 })).toBe(cfg);
    const full = log(...Array.from({ length: MAX_STUDY_ENTRIES }, () => anki));
    expect(addStudy(full, anki)).toBe(full);
  });
});

describe("the readings", () => {
  const cfg = log(earlier, article, anki);

  it("names the newest day studied", () => {
    expect(lastStudyDay(cfg)).toBe("2026-09-24");
    expect(lastStudyDay(EMPTY_STUDY)).toBeNull();
  });

  it("counts a day once however many sittings it held", () => {
    expect(studyDays(cfg)).toBe(2);
    expect(studyDays(EMPTY_STUDY)).toBe(0);
  });

  it("lists the distinct days inside a window", () => {
    expect(studyDaysIn(cfg, { from: "2026-09-18", to: "2026-09-24" })).toEqual([
      "2026-09-20",
      "2026-09-24",
    ]);
    expect(studyDaysIn(cfg, { from: "2026-09-21", to: "2026-09-23" })).toEqual(
      [],
    );
  });

  it("draws the trailing strip ending today, oldest first", () => {
    expect(studyDaysTrailing(cfg, "2026-09-24")).toEqual([0, 0, 1, 0, 0, 0, 2]);
    expect(studyDaysTrailing(cfg, "2026-09-25", 3)).toEqual([0, 2, 0]);
  });
});
