import { describe, expect, it } from "vitest";
import { apertureHistDay, apertureHistPath } from "./aevcontext";
import { type ApertureDoc, type AperturePath } from "./aperture";
import {
  marksTrends,
  planRecordFetch,
  RECORD_FETCH_CAP,
  recordRows,
  recordTrends,
  strikeTrends,
} from "./aperturerecord";

// Wholly invented seals — this repo is public, so the fixtures are fiction by
// construction and share nothing with the real sealed history but its SHAPE.
// Same cartographer as `aperturesync.test.ts`, so the two read as one persona.
function doc(over: {
  rank?: number;
  stage?: string;
  logbook?: number;
}): ApertureDoc {
  return {
    v: 1,
    sealedAt: "2026-03-05T09:00:00+10:00",
    public: { rank: over.rank ?? 3, stage: over.stage ?? "upper" },
    sealed: {
      streaks: {
        logbook: { count: over.logbook ?? 12, target: 60, state: "active" },
      },
      conditions: [
        {
          id: "K1",
          label: "Morning pages",
          status: "hardening",
          progress: 12,
          target: 30,
          unit: "days",
        },
      ],
      paths: [{ name: "cartography" }],
      trials: [{ name: "The long portage", tier: "earthly", state: "stocked" }],
      breakthrough: {
        wall: "3→4",
        event: "a season without a missed logbook week",
        routes: ["survey the northern shelf"],
        recentStrikes: {},
      },
    },
  };
}

describe("planRecordFetch", () => {
  it("validates, dedupes, sorts newest-first, and caps", () => {
    const days = [
      "2026-07-05",
      "2026-07-26", // out of order — the plan must not trust wire order
      "2026-07-26", // duplicate
      "2026-7-12", // unpadded — dropped
      "not-a-day", // dropped
      42, // dropped
      null, // dropped
    ];
    expect(planRecordFetch(days)).toEqual({
      fetch: ["2026-07-26", "2026-07-05"],
      older: 0,
    });
  });

  it("plans nothing from a listing that is not an array", () => {
    for (const bad of [null, undefined, "2026-07-26", { days: [] }, 7])
      expect(planRecordFetch(bad)).toEqual({ fetch: [], older: 0 });
  });

  it("counts everything past the cap as older, never fetching it", () => {
    const days = Array.from(
      { length: RECORD_FETCH_CAP + 5 },
      (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`,
    );
    const plan = planRecordFetch(days);
    expect(plan.fetch).toHaveLength(RECORD_FETCH_CAP);
    expect(plan.fetch[0]).toBe(`2026-01-${RECORD_FETCH_CAP + 5}`);
    expect(plan.older).toBe(5);
  });

  it("accepts exactly what the aevcontext family accepts", () => {
    // The local day shape and the dated-key family must never drift: a day the
    // plan fetches has to build the key the island decrypts under.
    for (const day of ["2026-07-26", "1999-01-01"]) {
      expect(planRecordFetch([day]).fetch).toEqual([day]);
      expect(apertureHistDay(apertureHistPath(day))).toBe(day);
    }
    for (const day of ["2026-7-26", "26-07-26", "latest"]) {
      expect(planRecordFetch([day]).fetch).toEqual([]);
      expect(apertureHistDay(apertureHistPath(day))).toBeNull();
    }
  });
});

describe("recordRows", () => {
  it("orders newest-first whatever order the fetches resolved in", () => {
    const rows = recordRows([
      { day: "2026-07-05", doc: doc({}) },
      { day: "2026-07-26", doc: doc({}) },
      { day: "2026-07-12", doc: doc({}) },
    ]);
    expect(rows.map((r) => r.day)).toEqual([
      "2026-07-26",
      "2026-07-12",
      "2026-07-05",
    ]);
  });

  it("carries rank, stage and the canon essence for each seal", () => {
    const [row] = recordRows([
      { day: "2026-07-26", doc: doc({ rank: 1, stage: "initial" }) },
    ]);
    expect(row).toMatchObject({
      rank: 1,
      stage: "initial",
      essence: "Jade Green",
    });
  });

  it("renders no essence for a rank/stage outside the canon", () => {
    const [row] = recordRows([
      { day: "2026-07-26", doc: doc({ rank: 99, stage: "transcendent" }) },
    ]);
    expect(row.essence).toBeNull();
  });

  it("delta reads against the seal below it, in the sync's own vocabulary", () => {
    const rows = recordRows([
      { day: "2026-07-26", doc: doc({ logbook: 19 }) },
      { day: "2026-07-19", doc: doc({ logbook: 12 }) },
    ]);
    expect(rows[0].delta).toBe("logbook 12→19");
    // The oldest fetched row has nothing older on screen to read against.
    expect(rows[1].delta).toBeNull();
  });

  it("a week where nothing in diff scope moved reads quiet, not noisy", () => {
    // Rank movement carries no segment of its own — the two rows already show
    // rank 3 above rank 2, and repeating that as prose doubled the line.
    const rows = recordRows([
      { day: "2026-07-26", doc: doc({ rank: 3 }) },
      { day: "2026-07-19", doc: doc({ rank: 2 }) },
    ]);
    expect(rows[0].delta).toBeNull();
  });

  it("an empty history makes no rows", () => {
    expect(recordRows([])).toEqual([]);
  });
});

// A seal carrying a WHOLE streak record — trends are about which names each seal
// carried, which the `doc` helper's single fixed streak can't say. Invented like
// everything else here: the names are a cartographer's, not an owner's.
function streakSeal(
  streaks: Record<string, { count: number; target?: number }>,
): ApertureDoc {
  const base = doc({});
  return {
    ...base,
    sealed: {
      ...base.sealed,
      streaks: Object.fromEntries(
        Object.entries(streaks).map(([name, s]) => [
          name,
          { count: s.count, target: s.target ?? 60, state: "active" },
        ]),
      ),
    },
  };
}

describe("recordTrends", () => {
  it("reads oldest → newest whatever order the fetches resolved in", () => {
    const trends = recordTrends([
      { day: "2026-07-26", doc: streakSeal({ logbook: { count: 19 } }) },
      { day: "2026-07-05", doc: streakSeal({ logbook: { count: 5 } }) },
      { day: "2026-07-12", doc: streakSeal({ logbook: { count: 12 } }) },
    ]);
    expect(trends).toEqual([
      { name: "logbook", values: [5, 12, 19], first: 5, last: 19, target: 60 },
    ]);
  });

  it("skips a seal from before a streak existed rather than zeroing it", () => {
    const trends = recordTrends([
      { day: "2026-07-05", doc: streakSeal({ logbook: { count: 5 } }) },
      {
        day: "2026-07-12",
        doc: streakSeal({ logbook: { count: 12 }, portage: { count: 1 } }),
      },
      {
        day: "2026-07-26",
        doc: streakSeal({ logbook: { count: 19 }, portage: { count: 3 } }),
      },
    ]);
    // First-seen order walking oldest → newest, so logbook leads the newcomer.
    expect(trends.map((t) => t.name)).toEqual(["logbook", "portage"]);
    expect(trends[1]).toMatchObject({ values: [1, 3], first: 1, last: 3 });
  });

  it("drops a streak seen once — one reading is not a trend", () => {
    const trends = recordTrends([
      { day: "2026-07-12", doc: streakSeal({ logbook: { count: 12 } }) },
      {
        day: "2026-07-26",
        doc: streakSeal({ logbook: { count: 19 }, portage: { count: 3 } }),
      },
    ]);
    expect(trends.map((t) => t.name)).toEqual(["logbook"]);
  });

  it("takes the target from the newest seal, and null once it drops the streak", () => {
    const trends = recordTrends([
      {
        day: "2026-07-12",
        doc: streakSeal({
          logbook: { count: 12, target: 60 },
          portage: { count: 3, target: 10 },
        }),
      },
      {
        day: "2026-07-19",
        doc: streakSeal({
          logbook: { count: 19, target: 90 },
          portage: { count: 4, target: 10 },
        }),
      },
      { day: "2026-07-26", doc: streakSeal({ logbook: { count: 26 } }) },
    ]);
    expect(trends.find((t) => t.name === "logbook")?.target).toBe(60);
    expect(trends.find((t) => t.name === "portage")?.target).toBeNull();
  });

  it("treats a streak named like an Object member as data, not a method", () => {
    const trends = recordTrends([
      { day: "2026-07-12", doc: streakSeal({ toString: { count: 2 } }) },
      { day: "2026-07-26", doc: streakSeal({ toString: { count: 9 } }) },
    ]);
    expect(trends).toEqual([
      { name: "toString", values: [2, 9], first: 2, last: 9, target: 60 },
    ]);
  });

  it("makes no trends from an empty or single-seal history", () => {
    expect(recordTrends([])).toEqual([]);
    expect(
      recordTrends([
        { day: "2026-07-26", doc: streakSeal({ logbook: { count: 19 } }) },
      ]),
    ).toEqual([]);
  });
});

// A seal carrying a WHOLE strike record — the wall's own counters, which the
// `doc` helper leaves empty. Invented like every other fixture here.
function strikeSeal(recentStrikes: Record<string, number>): ApertureDoc {
  const base = doc({});
  return {
    ...base,
    sealed: {
      ...base.sealed,
      breakthrough: { ...base.sealed.breakthrough, recentStrikes },
    },
  };
}

describe("strikeTrends", () => {
  it("reads oldest → newest whatever order the fetches resolved in", () => {
    const trends = strikeTrends([
      { day: "2026-07-26", doc: strikeSeal({ petitions: 0 }) },
      { day: "2026-07-05", doc: strikeSeal({ petitions: 30 }) },
      { day: "2026-07-12", doc: strikeSeal({ petitions: 11 }) },
    ]);
    // No target ever: the wall breaks on an event, not on a count of strikes.
    expect(trends).toEqual([
      {
        name: "petitions",
        values: [30, 11, 0],
        first: 30,
        last: 0,
        target: null,
      },
    ]);
  });

  it("skips a seal from before a counter existed rather than zeroing it", () => {
    const trends = strikeTrends([
      { day: "2026-07-05", doc: strikeSeal({ petitions: 30 }) },
      { day: "2026-07-12", doc: strikeSeal({ petitions: 11, surveys: 1 }) },
      { day: "2026-07-26", doc: strikeSeal({ petitions: 0, surveys: 3 }) },
    ]);
    // First-seen order walking oldest → newest, so petitions leads the newcomer.
    expect(trends.map((t) => t.name)).toEqual(["petitions", "surveys"]);
    expect(trends[1]).toMatchObject({ values: [1, 3], first: 1, last: 3 });
  });

  it("drops a counter seen once — one reading is not a trend", () => {
    const trends = strikeTrends([
      { day: "2026-07-12", doc: strikeSeal({ petitions: 11 }) },
      { day: "2026-07-26", doc: strikeSeal({ petitions: 0, surveys: 3 }) },
    ]);
    expect(trends.map((t) => t.name)).toEqual(["petitions"]);
  });

  it("treats a counter named like an Object member as data, not a method", () => {
    const trends = strikeTrends([
      { day: "2026-07-12", doc: strikeSeal({ toString: 2 }) },
      { day: "2026-07-26", doc: strikeSeal({ toString: 9 }) },
    ]);
    expect(trends).toEqual([
      { name: "toString", values: [2, 9], first: 2, last: 9, target: null },
    ]);
  });

  it("makes no trends from an empty, unstruck or single-seal history", () => {
    expect(strikeTrends([])).toEqual([]);
    expect(
      strikeTrends([
        { day: "2026-07-12", doc: strikeSeal({}) },
        { day: "2026-07-26", doc: strikeSeal({}) },
      ]),
    ).toEqual([]);
    expect(
      strikeTrends([{ day: "2026-07-26", doc: strikeSeal({ petitions: 0 }) }]),
    ).toEqual([]);
  });
});

// A seal carrying a WHOLE paths tree — marks trends are about which ledgers each
// seal had OPENED, which the `doc` helper's one bare path can't say. Invented
// like everything else here.
function marksSeal(paths: AperturePath[]): ApertureDoc {
  const base = doc({});
  return { ...base, sealed: { ...base.sealed, paths } };
}

describe("marksTrends", () => {
  it("reads oldest → newest whatever order the fetches resolved in", () => {
    const seal = (count: number) =>
      marksSeal([
        { name: "Cartography", marks: { count, unit: "survey days" } },
      ]);
    const trends = marksTrends([
      { day: "2026-07-26", doc: seal(19) },
      { day: "2026-07-05", doc: seal(5) },
      { day: "2026-07-12", doc: seal(12) },
    ]);
    // Lowercased into the band's register, and no target ever: marks have no
    // ceiling to read against.
    expect(trends).toEqual([
      {
        name: "cartography",
        values: [5, 12, 19],
        first: 5,
        last: 19,
        target: null,
      },
    ]);
  });

  it("gives a sub-path's ledger a strip of its own, under its own name", () => {
    const seal = (body: number, portage: number) =>
      marksSeal([
        {
          name: "Body",
          marks: { count: body, unit: "sessions" },
          sub: [
            { name: "Portage", marks: { count: portage, unit: "carries" } },
          ],
        },
      ]);
    const trends = marksTrends([
      { day: "2026-07-12", doc: seal(4, 1) },
      { day: "2026-07-26", doc: seal(9, 3) },
    ]);
    // Reading order — a path before its subs — and never summed into the parent:
    // sessions and carries are different substances.
    expect(trends).toEqual([
      { name: "body", values: [4, 9], first: 4, last: 9, target: null },
      { name: "portage", values: [1, 3], first: 1, last: 3, target: null },
    ]);
  });

  it("skips a seal from before a ledger opened rather than zeroing it", () => {
    const trends = marksTrends([
      {
        day: "2026-07-05",
        doc: marksSeal([
          { name: "Cartography", marks: { count: 5, unit: "survey days" } },
          { name: "Portage" },
        ]),
      },
      {
        day: "2026-07-12",
        doc: marksSeal([
          { name: "Cartography", marks: { count: 12, unit: "survey days" } },
          { name: "Portage", marks: { count: 1, unit: "carries" } },
        ]),
      },
      {
        day: "2026-07-26",
        doc: marksSeal([
          { name: "Cartography", marks: { count: 19, unit: "survey days" } },
          { name: "Portage", marks: { count: 3, unit: "carries" } },
        ]),
      },
    ]);
    // First-seen order walking oldest → newest, so cartography leads the newcomer.
    expect(trends.map((t) => t.name)).toEqual(["cartography", "portage"]);
    expect(trends[1]).toMatchObject({ values: [1, 3], first: 1, last: 3 });
  });

  it("drops a ledger seen once — one reading is not a trend", () => {
    const trends = marksTrends([
      {
        day: "2026-07-12",
        doc: marksSeal([
          { name: "Cartography", marks: { count: 12, unit: "survey days" } },
        ]),
      },
      {
        day: "2026-07-26",
        doc: marksSeal([
          { name: "Cartography", marks: { count: 19, unit: "survey days" } },
          { name: "Portage", marks: { count: 3, unit: "carries" } },
        ]),
      },
    ]);
    expect(trends.map((t) => t.name)).toEqual(["cartography"]);
  });

  it("makes no trends from an empty, ledgerless or single-seal history", () => {
    expect(marksTrends([])).toEqual([]);
    expect(
      marksTrends([
        { day: "2026-07-12", doc: marksSeal([{ name: "Cartography" }]) },
        { day: "2026-07-26", doc: marksSeal([{ name: "Cartography" }]) },
      ]),
    ).toEqual([]);
    expect(
      marksTrends([
        {
          day: "2026-07-26",
          doc: marksSeal([
            { name: "Cartography", marks: { count: 19, unit: "survey days" } },
          ]),
        },
      ]),
    ).toEqual([]);
  });
});
