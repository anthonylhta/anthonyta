import { describe, expect, it } from "vitest";
import { riichiStats } from "./riichi";

const today = "2026-06-27";

describe("riichiStats — streaks (mirrors riichi's streakFromDays)", () => {
  it("counts a current streak of correct days ending today", () => {
    const rows = [
      { date: "2026-06-25", correct: true },
      { date: "2026-06-26", correct: true },
      { date: "2026-06-27", correct: true },
    ];
    const s = riichiStats(rows, today, 7);
    expect(s.currentStreak).toBe(3);
    expect(s.todaySolved).toBe(true);
  });

  it("keeps the streak alive when today isn't answered yet", () => {
    const rows = [
      { date: "2026-06-25", correct: true },
      { date: "2026-06-26", correct: true },
    ];
    const s = riichiStats(rows, today, 7);
    expect(s.currentStreak).toBe(2);
    expect(s.todaySolved).toBe(false);
  });

  it("breaks the current streak on a wrong day", () => {
    const rows = [
      { date: "2026-06-25", correct: true },
      { date: "2026-06-26", correct: false },
      { date: "2026-06-27", correct: true },
    ];
    const s = riichiStats(rows, today, 7);
    expect(s.currentStreak).toBe(1); // only today
  });

  it("best is the longest contiguous correct run, even if not current", () => {
    const rows = [
      { date: "2026-06-20", correct: true },
      { date: "2026-06-21", correct: true },
      { date: "2026-06-22", correct: true },
      { date: "2026-06-23", correct: false },
      { date: "2026-06-27", correct: true },
    ];
    const s = riichiStats(rows, today, 7);
    expect(s.bestStreak).toBe(3);
    expect(s.currentStreak).toBe(1);
  });

  it("a gap (missed day) is not contiguous, so it breaks best", () => {
    const rows = [
      { date: "2026-06-20", correct: true },
      { date: "2026-06-22", correct: true }, // skipped the 21st
    ];
    expect(riichiStats(rows, today, 7).bestStreak).toBe(1);
  });
});

describe("riichiStats — activity window", () => {
  it("maps solved → 2, attempted-wrong → 1, missed → 0, oldest → newest", () => {
    const rows = [
      { date: "2026-06-25", correct: true }, // 2
      { date: "2026-06-26", correct: false }, // 1
      // 2026-06-27 (today) missing → 0
    ];
    expect(riichiStats(rows, today, 3).activity).toEqual([2, 1, 0]);
  });

  it("returns exactly `days` entries", () => {
    expect(riichiStats([], today, 70).activity).toHaveLength(70);
  });
});
