import { describe, expect, it } from "vitest";
import type { ApertureRefinement } from "./aperture";
import type { GuMarksConfig } from "./gumarks";
import {
  checkinBlock,
  checkinWindow,
  commitDaysIn,
  countersBlock,
  datesIn,
  dayBefore,
  eventLines,
  isDailyTitle,
  journalDaysIn,
  unsealedSince,
  type CheckinInput,
  type CountersInput,
} from "./checkin";

const TODAY = "2026-09-16";
const W = checkinWindow(TODAY);

describe("checkin — the window", () => {
  it("runs the seven days ending YESTERDAY", () => {
    expect(W.from).toBe("2026-09-09");
    expect(W.to).toBe("2026-09-15");
    expect(W.days).toHaveLength(7);
    expect(W.days[0]).toBe("2026-09-09");
    expect(W.days.at(-1)).toBe("2026-09-15");
    // the seal day is never in it — today counts next week
    expect(W.days).not.toContain(TODAY);
  });

  it("steps over a month end and a leap day", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2024-03-01")).toBe("2024-02-29");
    expect(checkinWindow("2026-01-02").from).toBe("2025-12-26");
  });
});

describe("checkin — the journal", () => {
  it("counts the window's daily notes and names the gaps", () => {
    const titles = [
      ...W.days.filter((d) => d !== "2026-09-11" && d !== "2026-09-14"),
      "the operator's handbook",
      "2026-09-16",
      "2026-09-01",
    ];
    expect(journalDaysIn(titles, W)).toEqual({
      count: 5,
      missed: ["2026-09-11", "2026-09-14"],
    });
  });

  it("reads a full week as seven", () => {
    expect(journalDaysIn(W.days, W)).toEqual({ count: 7, missed: [] });
  });

  it("knows a daily title from every other note", () => {
    expect(isDailyTitle("2026-09-14")).toBe(true);
    expect(isDailyTitle("2026-09-14 — the seal")).toBe(false);
    expect(isDailyTitle("reverend insanity")).toBe(false);
  });
});

describe("checkin — dated rows", () => {
  it("keeps what falls inside, in order, duplicates and all", () => {
    expect(
      datesIn(
        ["2026-09-13", "2026-09-08", "2026-09-10", "2026-09-16", "2026-09-13"],
        W,
      ),
    ).toEqual(["2026-09-10", "2026-09-13", "2026-09-13"]);
  });
});

describe("checkin — the event sweep", () => {
  it("stamps each tagged line with its day and peels the marker", () => {
    expect(
      eventLines([
        {
          day: "2026-09-14",
          text: "## the day\n- #evidence — log-fed gu clocks, PR #252 merged\nnothing tagged here\n",
        },
        { day: "2026-09-10", text: "> #trial the surgeon's date moved" },
      ]),
    ).toEqual([
      "#trial 09-10 — the surgeon's date moved",
      "#evidence 09-14 — log-fed gu clocks, PR #252 merged",
    ]);
  });

  it("takes a bare tag as a line of its own, and ignores a longer word", () => {
    expect(
      eventLines([
        { day: "2026-09-12", text: "#stock\n#evidenced by nothing\n#gu cast" },
      ]),
    ).toEqual(["#stock 09-12", "#gu 09-12 — cast"]);
  });

  it("says nothing about an untagged week", () => {
    expect(eventLines([{ day: "2026-09-12", text: "a quiet day" }])).toEqual(
      [],
    );
  });
});

describe("checkin — the commit window", () => {
  it("counts the levels behind today, never today itself", () => {
    // ten cells ending today: the last is the seal day and drops out
    const levels = [0, 4, 0, 1, 0, 2, 3, 0, 1, 4];
    expect(commitDaysIn(levels, W)).toBe(4);
    expect(commitDaysIn([], W)).toBe(0);
    expect(commitDaysIn([3], W)).toBe(0);
  });
});

describe("checkin — the pending gu marks", () => {
  const refining: ApertureRefinement[] = [
    { name: "the library card", rank: "1", type: "consumable", test: "read" },
    {
      name: "all-out effort",
      rank: "1 → 6",
      type: "human",
      test: "a full cycle",
      since: "2026-07-14",
    },
  ];
  const cfg: GuMarksConfig = {
    v: 1,
    marks: {
      "the library card": { since: "2026-09-13" },
      "all-out effort": { since: "2026-07-14" },
      "a pizza, from dough": { since: "2026-09-01" },
    },
  };

  it("names only the marks the seal has not taken", () => {
    // the sealed entry already dates its own since; the third name left the book
    expect(unsealedSince(cfg, refining)).toEqual(["the library card"]);
    expect(unsealedSince({ v: 1, marks: {} }, refining)).toEqual([]);
  });
});

const FULL: CheckinInput = {
  today: TODAY,
  window: W,
  journal: { count: 7, missed: [] },
  finance: { buyDay: null, lastDay: "2026-09-09" },
  gymDays: ["2026-09-10", "2026-09-13"],
  events: ["#evidence 09-14 — log-fed gu clocks, PR #252 merged"],
  strikes: 1,
};

describe("checkin — the six lines", () => {
  it("renders the template as the mockup prints it", () => {
    expect(checkinBlock(FULL)).toBe(
      [
        "## Aperture weekly — week ending 2026-09-16",
        "Journal: 7/7",
        "Finance ritual: ? — no import since 09-09",
        "Gym: 2 sessions (09-10, 09-13)",
        "Events: #evidence 09-14 — log-fed gu clocks, PR #252 merged",
        "Wall strikes: 1 application · ? Ishin/validation actions",
        "Notes: ?",
      ].join("\n"),
    );
  });

  it("writes a ? wherever the page cannot count", () => {
    expect(
      checkinBlock({
        ...FULL,
        journal: null,
        finance: null,
        gymDays: null,
        events: null,
        strikes: null,
      }),
    ).toBe(
      [
        "## Aperture weekly — week ending 2026-09-16",
        "Journal: ?",
        "Finance ritual: ?",
        "Gym: ?",
        "Events: …",
        "Wall strikes: ? applications · ? Ishin/validation actions",
        "Notes: ?",
      ].join("\n"),
    );
  });

  it("names the missed days, the week's buy, and an empty week", () => {
    const block = checkinBlock({
      ...FULL,
      journal: { count: 5, missed: ["2026-09-11", "2026-09-14"] },
      finance: { buyDay: "2026-09-09", lastDay: "2026-09-09" },
      gymDays: [],
      events: [],
      strikes: 0,
    });
    expect(block).toContain("Journal: 5/7 (missed 09-11, 09-14)");
    expect(block).toContain("Finance ritual: done (buy 09-09)");
    expect(block).toContain("Gym: 0 sessions");
    expect(block).toContain("Events: none");
    expect(block).toContain("Wall strikes: 0 applications");
  });

  it("hangs a second event line under the first", () => {
    expect(
      checkinBlock({ ...FULL, events: ["#trial 09-10 — a", "#gu 09-12 — b"] }),
    ).toContain("Events: #trial 09-10 — a\n  #gu 09-12 — b\n");
  });

  it("says so when the ledger has never been imported", () => {
    expect(
      checkinBlock({ ...FULL, finance: { buyDay: null, lastDay: null } }),
    ).toContain("Finance ritual: ? — no import yet");
  });
});

const WEALTH: NonNullable<CountersInput["wealth"]> = {
  totalCents: 2000000,
  investedCents: 1200000,
  cashCents: 500000,
  hisaCents: 300000,
  weekDeltaCents: 25000,
};

const COUNTERS: CountersInput = {
  window: W,
  commitDays: 5,
  gymSessions: 2,
  mealDays: 6,
  studyDays: ["2026-09-10", "2026-09-13"],
  marks: { since: [], casts: [] },
  wealth: WEALTH,
};

describe("checkin — the counters", () => {
  it("renders the counters the seal also takes", () => {
    expect(countersBlock(COUNTERS)).toBe(
      [
        "Craft: +5 commit days (09-09..09-15, the github calendar)",
        "Japanese: +2 study days (09-10, 09-13)",
        "Training: +2 sessions · Meals: +6 days logged",
        "Net worth: $20,000 (invested $12,000 · cash $5,000 · HISA $3,000) · wk +$250",
        "gu marks unsealed: none · casts unsealed: none",
        "platform: ? (bait held · bar met · bar spoken)",
      ].join("\n"),
    );
  });

  it("counts a week with no sittings as +0, not ?", () => {
    expect(countersBlock({ ...COUNTERS, studyDays: [] })).toContain(
      "Japanese: +0 study days",
    );
  });

  it("names the pending marks and casts", () => {
    expect(
      countersBlock({
        ...COUNTERS,
        marks: {
          since: ["the library card", "the seat"],
          casts: [{ name: "a ticket", date: "2026-09-12" }],
        },
      }),
    ).toContain(
      "gu marks unsealed: 2 (the library card · the seat) · casts unsealed: 1 (a ticket 09-12)",
    );
  });

  it("writes a ? wherever a log has not landed", () => {
    expect(
      countersBlock({
        window: W,
        commitDays: null,
        gymSessions: null,
        mealDays: null,
        studyDays: null,
        marks: null,
        wealth: null,
      }),
    ).toBe(
      [
        "Craft: ? commit days",
        "Japanese: ? study days",
        "Training: ? sessions · Meals: ? days logged",
        "Net worth: ?",
        "gu marks unsealed: ? · casts unsealed: ?",
        "platform: ? (bait held · bar met · bar spoken)",
      ].join("\n"),
    );
  });

  const wealthOf = (wealth: Partial<typeof WEALTH>) =>
    countersBlock({ ...COUNTERS, wealth: { ...WEALTH, ...wealth } });

  it("writes wk ? when the ledger does not reach back a week", () => {
    expect(wealthOf({ weekDeltaCents: null })).toContain(
      "Net worth: $20,000 (invested $12,000 · cash $5,000 · HISA $3,000) · wk ?",
    );
  });

  it("signs the week's delta either way, +$0 for a flat week", () => {
    expect(wealthOf({ weekDeltaCents: -250075 })).toContain("· wk -$2,501");
    expect(wealthOf({ weekDeltaCents: 0 })).toContain("· wk +$0");
    expect(wealthOf({ weekDeltaCents: -40 })).toContain("· wk +$0");
  });

  it("rounds cents to whole dollars and groups the thousands", () => {
    expect(
      wealthOf({
        totalCents: 123456789,
        investedCents: 49,
        cashCents: 50,
        hisaCents: 99999,
      }),
    ).toContain(
      "Net worth: $1,234,568 (invested $0 · cash $1 · HISA $1,000) · wk +$250",
    );
  });
});
