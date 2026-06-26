import { describe, expect, it } from "vitest";
import { contribLevel, relativeTime, streaks, summarizeGithub } from "./github";

describe("contribLevel", () => {
  it("is 0 for no contributions", () => {
    expect(contribLevel(0, 10)).toBe(0);
  });
  it("buckets by quartile of the busiest day", () => {
    expect(contribLevel(1, 100)).toBe(1);
    expect(contribLevel(40, 100)).toBe(2);
    expect(contribLevel(70, 100)).toBe(3);
    expect(contribLevel(100, 100)).toBe(4);
  });
  it("never returns 0 for a nonzero count", () => {
    expect(contribLevel(1, 1000)).toBe(1);
  });
});

describe("streaks", () => {
  it("counts the current run ending today", () => {
    expect(streaks([0, 1, 1, 2, 3])).toEqual({
      currentStreak: 4,
      bestStreak: 4,
    });
  });
  it("keeps the streak alive when today is still empty", () => {
    expect(streaks([1, 2, 3, 0]).currentStreak).toBe(3);
  });
  it("resets the current streak after a real gap", () => {
    expect(streaks([1, 1, 0, 1])).toEqual({ currentStreak: 1, bestStreak: 2 });
  });
  it("handles an all-empty history", () => {
    expect(streaks([0, 0, 0])).toEqual({ currentStreak: 0, bestStreak: 0 });
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-06-26T12:00:00Z");
  it("returns null for an empty timestamp", () => {
    expect(relativeTime("", now)).toBeNull();
  });
  it("formats minutes, hours, days, weeks", () => {
    expect(relativeTime("2026-06-26T11:58:00Z", now)).toBe("2m ago");
    expect(relativeTime("2026-06-26T10:00:00Z", now)).toBe("2h ago");
    expect(relativeTime("2026-06-23T12:00:00Z", now)).toBe("3d ago");
    expect(relativeTime("2026-06-05T12:00:00Z", now)).toBe("3w ago");
  });
});

describe("summarizeGithub", () => {
  const user = {
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: 5,
        weeks: [
          {
            contributionDays: [
              { contributionCount: 0, date: "2026-06-21" },
              { contributionCount: 4, date: "2026-06-22" },
              { contributionCount: 1, date: "2026-06-23" },
            ],
          },
        ],
      },
    },
    repositories: {
      totalCount: 7,
      nodes: [
        {
          name: "riichi",
          pushedAt: "2026-06-26T10:00:00Z",
          primaryLanguage: { name: "TypeScript" },
        },
      ],
    },
  };

  it("normalizes calendar, repos, and the recent push", () => {
    const s = summarizeGithub(user, "anthonylhta");
    expect(s.login).toBe("anthonylhta");
    expect(s.contributions).toBe(5);
    expect(s.publicRepos).toBe(7);
    expect(s.thisWeek).toBe(5); // 0 + 4 + 1, last 7 days
    expect(s.daily).toEqual([0, 4, 1]);
    expect(s.weeks[0]).toEqual([0, 4, 1]); // levels scaled to max=4
    expect(s.recent).toEqual({
      repo: "riichi",
      lang: "TypeScript",
      at: "2026-06-26T10:00:00Z",
    });
    expect(s.isLive).toBe(true);
  });

  it("labels the month at the first week of the calendar", () => {
    const s = summarizeGithub(user, "x");
    expect(s.months).toEqual([{ label: "Jun", week: 0 }]);
  });
});
