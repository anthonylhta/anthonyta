import { describe, expect, it } from "vitest";
import {
  ATTAINMENTS,
  IMMORTAL_ESSENCE,
  MORTAL_ESSENCE,
  essenceOf,
  isAdjudicationPending,
  isApertureStage,
  isAttainment,
  isConditionStatus,
  isSealStale,
  isTrialState,
  isTrialTier,
  normalizeAperture,
  normalizeApertureGlance,
} from "./aperture";

// Wholly invented status — this repo is public, so the fixture is fiction by
// construction and shares nothing with the real sealed blob but its SHAPE.
const doc = {
  v: 1,
  sealedAt: "2026-03-05T09:00:00+10:00",
  public: { rank: 3, stage: "upper" },
  sealed: {
    streaks: {
      logbook: {
        count: 12,
        target: 60,
        state: "active",
        earliestHarden: "2026-04-22",
      },
    },
    conditions: [
      {
        id: "K1",
        label: "Morning pages 60d",
        status: "hardening",
        progress: 12,
        target: 60,
        unit: "days",
      },
      {
        id: "K2",
        label: "Weekly review",
        status: "suspended",
        progress: 3,
        target: 8,
        unit: "weeks",
      },
    ],
    paths: [
      {
        name: "Smithing",
        role: "main",
        attainment: "quasi-master",
        note: "tempering",
        activity: "forgings",
      },
      {
        name: "Cartography",
        role: "latent",
        sub: [{ name: "Star charts", attainment: "ordinary", verified: false }],
      },
    ],
    vitalGu: { name: "Lodestone", rank: 2, max: 5 },
    trials: [
      {
        name: "Winter crossing",
        tier: "earthly",
        state: "passed",
        date: "2026-01-19",
      },
      {
        name: "Guild examination",
        tier: "heavenly",
        state: "stocked",
        date: null,
        provisioned: true,
      },
    ],
    breakthrough: {
      wall: "3→4",
      event: "First charter commission",
      routes: ["signed charter", "guild sponsorship"],
      recentStrikes: { petitions: 2 },
    },
  },
};

/** The fixture with its sealed block patched — every rejection case is one
 *  well-formed document with exactly ONE thing wrong with it. */
const withSealed = (patch: Record<string, unknown>) => ({
  ...doc,
  sealed: { ...doc.sealed, ...patch },
});

const glance = {
  v: 1,
  sealedAt: "2026-03-05T09:00:00+10:00",
  rank: 3,
  stage: "upper",
};

describe("aperture — canon table", () => {
  it("holds exactly the 20 mortal essence names, cell for cell", () => {
    // The table IS the product — not derived, not fetched, not adjudicated. A
    // silent edit to one cell has to fail a test, so the expectation spells the
    // whole canon out rather than looping over the table it is checking.
    expect(MORTAL_ESSENCE).toEqual({
      1: {
        initial: "Jade Green",
        middle: "Pale Green",
        upper: "Dark Green",
        peak: "Black Green",
      },
      2: {
        initial: "Light Red",
        middle: "Scarlet",
        upper: "Crimson",
        peak: "Dark Red",
      },
      3: {
        initial: "Light Silver",
        middle: "Blossom Silver",
        upper: "Bright Silver",
        peak: "Snow Silver",
      },
      4: {
        initial: "Light Gold",
        middle: "Bright Gold",
        upper: "Essence Gold",
        peak: "True Gold",
      },
      5: {
        initial: "Light Purple",
        middle: "Violet",
        upper: "Deep Purple",
        peak: "Crystal Purple",
      },
    });
  });

  it("holds exactly the 4 immortal essence names", () => {
    expect(IMMORTAL_ESSENCE).toEqual({
      6: "Green Grape",
      7: "Red Date",
      8: "White Litchi",
      9: "Yellow Apricot",
    });
  });

  it("names all 24 essences distinctly", () => {
    // A repeated name would make two ranks indistinguishable at a glance, which
    // is the one thing the colour is for.
    const names = [
      ...Object.values(MORTAL_ESSENCE).flatMap((byStage) =>
        Object.values(byStage),
      ),
      ...Object.values(IMMORTAL_ESSENCE),
    ];
    expect(names).toHaveLength(24);
    expect(new Set(names).size).toBe(24);
  });
});

describe("aperture — essenceOf", () => {
  it("looks a mortal rank up by its stage", () => {
    expect(essenceOf(1, "initial")).toBe("Jade Green");
    expect(essenceOf(3, "upper")).toBe("Bright Silver");
    expect(essenceOf(5, "peak")).toBe("Crystal Purple");
  });

  it("returns null for a mortal rank with an unknown or missing stage", () => {
    // Null is "no canon entry" — the panel renders the literal stage muted
    // rather than picking a colour the canon never assigned.
    expect(essenceOf(2, "transcendent")).toBeNull();
    expect(essenceOf(2)).toBeNull();
    expect(essenceOf(2, null)).toBeNull();
  });

  it("ignores the stage entirely for an immortal rank", () => {
    // Immortal ranks have no stages; a stage arriving anyway must not change the
    // answer, and must not blank it either.
    expect(essenceOf(7, "peak")).toBe("Red Date");
    expect(essenceOf(7)).toBe("Red Date");
    expect(essenceOf(6, "initial")).toBe("Green Grape");
    expect(essenceOf(9, null)).toBe("Yellow Apricot");
  });

  it("returns null for any rank off the ladder", () => {
    expect(essenceOf(0, "initial")).toBeNull();
    expect(essenceOf(10, "initial")).toBeNull();
    expect(essenceOf(1.5, "initial")).toBeNull();
    expect(essenceOf(Number.NaN, "initial")).toBeNull();
  });
});

describe("aperture — normalizeAperture", () => {
  it("accepts the sealed document unchanged", () => {
    const out = normalizeAperture(doc);
    expect(out).not.toBeNull();
    expect(out).toEqual(doc);
  });

  it("drops an unknown top-level key", () => {
    // The blob has ONE writer, but the rebuild is what makes that true at the
    // render boundary: nothing a tampered store bolts on rides into the panel.
    const out = normalizeAperture({ ...doc, smuggled: true });
    expect(out).toEqual(doc);
    expect(out).not.toHaveProperty("smuggled");
  });

  it("drops an unknown key nested inside a condition", () => {
    const out = normalizeAperture(
      withSealed({
        conditions: [{ ...doc.sealed.conditions[0], smuggled: "x" }],
      }),
    );
    expect(out?.sealed.conditions).toEqual([doc.sealed.conditions[0]]);
  });

  it("keeps an absent optional absent", () => {
    // Absent optional → default (stay absent); PRESENT-but-malformed → reject.
    const out = normalizeAperture(withSealed({ vitalGu: undefined }));
    expect(out).not.toBeNull();
    expect(out?.sealed).not.toHaveProperty("vitalGu");
  });
});

describe("aperture — frame rejections", () => {
  it("rejects anything that isn't an object", () => {
    expect(normalizeAperture(null)).toBeNull();
    expect(normalizeAperture("v1")).toBeNull();
    expect(normalizeAperture(1)).toBeNull();
  });

  it("rejects any version but 1", () => {
    // No widening branch exists yet — a v2 emitter must ship code here first.
    expect(normalizeAperture({ ...doc, v: 2 })).toBeNull();
  });

  it("rejects a missing or unparseable sealedAt", () => {
    const { v, public: pub, sealed } = doc;
    expect(normalizeAperture({ v, public: pub, sealed })).toBeNull();
    expect(normalizeAperture({ ...doc, sealedAt: "not-a-date" })).toBeNull();
  });

  it("rejects a public block with the rank as a string", () => {
    expect(
      normalizeAperture({ ...doc, public: { rank: "3", stage: "upper" } }),
    ).toBeNull();
  });

  it("rejects a conditions field that isn't an array", () => {
    expect(normalizeAperture(withSealed({ conditions: {} }))).toBeNull();
  });

  it("rejects an array where an OPEN RECORD belongs", () => {
    // An array reaching a record field is present-but-malformed, so it rejects
    // rather than coercing: `[2]` must never render as the strike counter "0".
    expect(normalizeAperture(withSealed({ streaks: [] }))).toBeNull();
    expect(
      normalizeAperture(
        withSealed({
          breakthrough: { ...doc.sealed.breakthrough, recentStrikes: [2] },
        }),
      ),
    ).toBeNull();
  });

  it("rejects a condition missing a required field", () => {
    expect(
      normalizeAperture(
        withSealed({
          conditions: [
            {
              id: "K1",
              label: "Morning pages 60d",
              status: "hardening",
              progress: 12,
              target: 60,
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects a number that arrived as a string", () => {
    // The panel does arithmetic on these — "12" would render as a bar of NaN.
    expect(
      normalizeAperture(
        withSealed({
          streaks: { logbook: { count: "12", target: 60, state: "active" } },
        }),
      ),
    ).toBeNull();
    expect(
      normalizeAperture(
        withSealed({
          breakthrough: {
            ...doc.sealed.breakthrough,
            recentStrikes: { petitions: "2" },
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejects a routes list holding anything but strings", () => {
    expect(
      normalizeAperture(
        withSealed({
          breakthrough: {
            ...doc.sealed.breakthrough,
            routes: ["signed charter", 3],
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejects a present-but-malformed vitalGu", () => {
    expect(
      normalizeAperture(
        withSealed({ vitalGu: { name: "Lodestone", rank: 2 } }),
      ),
    ).toBeNull();
  });
});

describe("aperture — the inward page's fields", () => {
  // The four optional additions the /aperture page reads: a path's gu list and
  // its next-rung line, the vital gu's candidates, and the rented lines. All four
  // are OPTIONAL, so the fixture above — which carries none of them — is also the
  // regression fixture for every document sealed before they existed.
  const enriched = withSealed({
    paths: [
      {
        name: "Smithing",
        role: "main",
        gu: [
          { name: "Bellows", type: "tool", bears: true },
          { name: "Quench trough" },
        ],
        next: "a commissioned blade a guild would sign for",
        sub: [
          {
            name: "Etching",
            gu: [{ name: "Acid stylus", type: "tool" }],
            next: "one plate legible at arm's length",
          },
        ],
      },
    ],
    vitalGu: {
      name: "",
      rank: 0,
      max: 5,
      candidates: ["Lodestone", "Ember flask"],
    },
    rented: ["a borrowed forge — paid by the day"],
  });

  it("accepts all four, sub-paths included", () => {
    expect(normalizeAperture(enriched)).toEqual(enriched);
  });

  it("normalizes a document carrying none of them exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("rented");
    expect(out?.sealed.paths[0]).not.toHaveProperty("gu");
    expect(out?.sealed.paths[0]).not.toHaveProperty("next");
    expect(out?.sealed.vitalGu).not.toHaveProperty("candidates");
  });

  it("carries the UNNAMED vital gu — an open slot is a state, not a fault", () => {
    // `name: ""` and `rank: 0` are what "the aperture is open and nothing has
    // been named into it" looks like; rejecting it would blank the whole panel.
    const out = normalizeAperture(
      withSealed({ vitalGu: { name: "", rank: 0, max: 5 } }),
    );
    expect(out?.sealed.vitalGu).toEqual({ name: "", rank: 0, max: 5 });
  });

  it("drops an unknown key nested inside a gu row", () => {
    const out = normalizeAperture(
      withSealed({
        paths: [{ name: "Smithing", gu: [{ name: "Bellows", smuggled: 1 }] }],
      }),
    );
    expect(out?.sealed.paths).toEqual([
      { name: "Smithing", gu: [{ name: "Bellows" }] },
    ]);
  });

  it("hard-rejects each one present-but-malformed", () => {
    const path = (patch: Record<string, unknown>) =>
      withSealed({ paths: [{ name: "Smithing", ...patch }] });
    expect(normalizeAperture(path({ gu: {} }))).toBeNull();
    expect(normalizeAperture(path({ gu: [{ name: 3 }] }))).toBeNull();
    expect(
      normalizeAperture(path({ gu: [{ name: "Bellows", bears: "yes" }] })),
    ).toBeNull();
    expect(
      normalizeAperture(path({ gu: [{ name: "Bellows", type: 1 }] })),
    ).toBeNull();
    expect(normalizeAperture(path({ next: 3 }))).toBeNull();
    // …and one bad row rejects the WHOLE list, never half of it.
    expect(
      normalizeAperture(path({ gu: [{ name: "Bellows" }, { type: "tool" }] })),
    ).toBeNull();
    expect(
      normalizeAperture(
        withSealed({ vitalGu: { name: "", rank: 0, max: 5, candidates: "x" } }),
      ),
    ).toBeNull();
    expect(
      normalizeAperture(
        withSealed({ vitalGu: { name: "", rank: 0, max: 5, candidates: [3] } }),
      ),
    ).toBeNull();
    expect(normalizeAperture(withSealed({ rented: "a forge" }))).toBeNull();
    expect(normalizeAperture(withSealed({ rented: [3] }))).toBeNull();
  });
});

describe("aperture — the sealed next line", () => {
  // What the next seal is waiting on: check-in prose, carried across the frame
  // untouched. The site never parses it, so the frame's only job is to insist
  // there is something to print.
  it("accepts a document carrying one", () => {
    const waiting = withSealed({
      next: "middle — when the logbook streak hardens, ~apr 22",
    });
    expect(normalizeAperture(waiting)).toEqual(waiting);
  });

  it("normalizes a document without one exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("next");
  });

  it("hard-rejects a present-but-malformed next line", () => {
    const bad = (next: unknown) =>
      expect(normalizeAperture(withSealed({ next }))).toBeNull();
    bad(3);
    bad("");
    bad(null);
    bad(["middle"]);
    bad({ stage: "middle" });
  });
});

describe("aperture — the sealed profile", () => {
  // Who the sheet is about. The birth DAY stays sealed (this repo is public) and
  // only the age it implies is ever rendered, so the frame has to be as strict
  // about it as about any other figure.
  const profiled = withSealed({
    profile: { born: "2001-08-19" },
  });

  it("accepts a well-formed profile", () => {
    expect(normalizeAperture(profiled)).toEqual(profiled);
  });

  it("accepts an empty profile — a real emission with nothing to say", () => {
    expect(
      normalizeAperture(withSealed({ profile: {} }))?.sealed.profile,
    ).toEqual({});
  });

  it("normalizes a document without one exactly as before", () => {
    // Every document sealed before the profile existed — absent stays absent, and
    // nothing else about the normalize moves.
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("profile");
  });

  it("drops an unknown key inside the profile", () => {
    const out = normalizeAperture(
      withSealed({
        profile: { born: "2001-08-19", now: "cut same-day", smuggled: "x" },
      }),
    );
    expect(out?.sealed.profile).toEqual({ born: "2001-08-19" });
  });

  it("hard-rejects a present-but-malformed profile", () => {
    const bad = (profile: unknown) =>
      expect(normalizeAperture(withSealed({ profile }))).toBeNull();
    bad("2001-08-19");
    bad({ born: 2001 });
    bad({ born: "19 August 2001" }); // a date, but not a day
    bad({ born: "2001-08-19T00:00:00Z" }); // an instant, not a day
    bad({ born: "2001-13-01" }); // shaped like a day, parses as nothing
  });
});

describe("aperture — dao marks", () => {
  // Adjudicated per-path totals in the path's OWN unit — never converted,
  // never summed (ADR 0167). Optional on paths AND sub-paths via normPath.
  const marked = withSealed({
    paths: [
      {
        name: "Smithing",
        role: "main",
        marks: { count: 1412, unit: "commit days" },
        sub: [{ name: "Etching", marks: { count: 0, unit: "plates etched" } }],
      },
    ],
  });

  it("accepts marks on a path and a sub-path — zero is a real ledger", () => {
    expect(normalizeAperture(marked)).toEqual(marked);
  });

  it("normalizes a document without any exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed.paths[0]).not.toHaveProperty("marks");
  });

  it("hard-rejects present-but-malformed marks", () => {
    const bad = (marks: unknown) =>
      expect(
        normalizeAperture(withSealed({ paths: [{ name: "P", marks }] })),
      ).toBeNull();
    bad("1412"); // a count where a ledger should be
    bad({ count: -1, unit: "days" }); // a ledger can be empty, never negative
    bad({ count: 3.5, unit: "days" }); // marks are whole
    bad({ count: 3, unit: "" }); // a unit either names the substance or the ledger is absent
    bad({ count: 3 }); // no unit at all
  });
});

describe("aperture — the soul", () => {
  // The second axis beside rank: every field adjudicated, the site printing them
  // verbatim (the raw day count beside the grade is the page's only computation).
  const soul = {
    grade: "hundred man soul",
    next: "thousand man soul",
    at: 1000,
    refined: true,
    harvested: 1,
    strained: false,
  };

  it("accepts a well-formed soul", () => {
    const souled = withSealed({ soul });
    expect(normalizeAperture(souled)).toEqual(souled);
  });

  it("accepts the strained state — the gate refusing, not a fault", () => {
    const strained = withSealed({
      soul: { ...soul, refined: false, harvested: 0, strained: true },
    });
    expect(normalizeAperture(strained)).toEqual(strained);
  });

  it("normalizes a document without one exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("soul");
  });

  it("drops an unknown key inside the soul", () => {
    const out = normalizeAperture(
      withSealed({ soul: { ...soul, mutated: 1 } }),
    );
    expect(out?.sealed.soul).toEqual(soul);
  });

  it("hard-rejects a present-but-malformed soul", () => {
    const bad = (patch: Record<string, unknown> | string) =>
      expect(
        normalizeAperture(
          withSealed({
            soul: typeof patch === "string" ? patch : { ...soul, ...patch },
          }),
        ),
      ).toBeNull();
    bad("hundred man soul"); // a word where a record should be
    bad({ grade: "" }); // a grade either names a band or is absent
    bad({ at: 0 }); // no band opens at day zero
    bad({ at: 999.5 }); // a day count is an integer
    bad({ refined: "yes" }); // the gate is a fact, not prose
    bad({ harvested: -1 }); // a harvest can be empty, never negative
    bad({ strained: 1 }); // same discipline as refined
  });
});

describe("aperture — killer moves", () => {
  // The named composite rituals: definitions sealed whole at the check-in, the
  // site deriving only the cast reading beside them. Same absent-vs-malformed
  // doctrine as every optional sealed field.
  const move = {
    name: "the wednesday ritual",
    chain: "csv → portfolio → check-in → seal",
    steps: ["export the csv", "run `npm run aperture-sync`"],
    evidence: "record",
    note: "casts counted from the record — one dated seal per casting.",
  };

  it("accepts a well-formed move, and one that leaves no trace", () => {
    const full = withSealed({ killerMoves: [move] });
    expect(normalizeAperture(full)).toEqual(full);
    // No evidence and no note is a real move — the documentation-only card.
    const bare = withSealed({
      killerMoves: [{ name: "the morning glance", chain: "a", steps: ["b"] }],
    });
    expect(normalizeAperture(bare)).toEqual(bare);
  });

  it("normalizes a document without any exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("killerMoves");
  });

  it("drops an unknown key inside a move", () => {
    const out = normalizeAperture(
      withSealed({ killerMoves: [{ ...move, mutated: 1 }] }),
    );
    expect(out?.sealed.killerMoves).toEqual([move]);
  });

  it("hard-rejects a present-but-malformed list", () => {
    const bad = (moves: unknown) =>
      expect(normalizeAperture(withSealed({ killerMoves: moves }))).toBeNull();
    bad("the wednesday ritual"); // a word where a list should be
    bad([{ ...move, name: "" }]); // a move either has a name or isn't one
    bad([{ ...move, steps: [] }]); // no steps → the unfold would be bare chrome
    bad([{ ...move, steps: ["a", 2] }]); // one bad step rejects the list
    bad([{ ...move, evidence: "chores" }]); // closed vocabulary — unknown source
    bad([{ ...move, note: "" }]); // an empty note is malformed, not silence
    bad(Array.from({ length: 13 }, (_, i) => ({ ...move, name: `m${i}` }))); // past the ceiling
  });
});

describe("aperture — gu houses", () => {
  // The colophon's input: name/type/origin sealed whole, printed verbatim; the
  // census beside the first house is derived and never rides the frame.
  const house = {
    name: "warm turtle house",
    type: "defensive type — storage and refinement · one master",
    origin: ["raised room by room", "burned once", "the shell has held since"],
  };

  it("accepts a well-formed house, alone and with a second", () => {
    const one = withSealed({ guHouses: [house] });
    expect(normalizeAperture(one)).toEqual(one);
    const two = withSealed({
      guHouses: [house, { name: "ishin", type: "refinement", origin: ["a"] }],
    });
    expect(normalizeAperture(two)).toEqual(two);
  });

  it("normalizes a document without any exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("guHouses");
  });

  it("drops an unknown key inside a house", () => {
    const out = normalizeAperture(
      withSealed({ guHouses: [{ ...house, mutated: 1 }] }),
    );
    expect(out?.sealed.guHouses).toEqual([house]);
  });

  it("hard-rejects a present-but-malformed list", () => {
    const bad = (houses: unknown) =>
      expect(normalizeAperture(withSealed({ guHouses: houses }))).toBeNull();
    bad("warm turtle house"); // a word where a list should be
    bad([{ ...house, name: "" }]); // a house either has a name or isn't one
    bad([{ ...house, origin: [] }]); // a house has a story or it isn't sealed yet
    bad([{ ...house, origin: ["a", 2] }]); // one bad beat rejects the list
    bad(Array.from({ length: 9 }, (_, i) => ({ ...house, name: `h${i}` }))); // past the ceiling
  });
});

describe("aperture — true inheritances", () => {
  // What was handed down and what is being left behind: sealed whole, the site
  // deriving only the header counts. Same absent-vs-malformed doctrine.
  const entry = {
    source: "reverend insanity",
    gave: "the framework itself",
    body: ["**Transmitted:** rank, essence, the wall, the aperture."],
  };
  const bare = {
    source: "the karpathy doctrine",
    gave: "how code gets written",
  };

  it("accepts both directions, and a body-less row as its own whole entry", () => {
    const full = withSealed({
      inheritances: { received: [entry, bare], left: [bare] },
    });
    expect(normalizeAperture(full)).toEqual(full);
    // The estate can be described before the formative list is worded.
    const leftOnly = withSealed({
      inheritances: { received: [], left: [entry] },
    });
    expect(normalizeAperture(leftOnly)).toEqual(leftOnly);
  });

  it("normalizes a document without any exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("inheritances");
  });

  it("drops an unknown key inside an entry and inside the wrapper", () => {
    const out = normalizeAperture(
      withSealed({
        inheritances: { received: [{ ...bare, mutated: 1 }], smuggled: true },
      }),
    );
    expect(out?.sealed.inheritances).toEqual({ received: [bare] });
  });

  it("hard-rejects a present-but-malformed frame", () => {
    const bad = (inheritances: unknown) =>
      expect(normalizeAperture(withSealed({ inheritances }))).toBeNull();
    bad("reverend insanity"); // a word where a record should be
    bad({ left: [bare] }); // received is the frame's floor — absent ≠ empty
    bad({ received: [{ ...bare, source: "" }] }); // an entry names its source or isn't one
    bad({ received: [{ ...entry, body: [] }] }); // a caret over nothing is bare chrome
    bad({ received: [{ ...entry, body: ["a", 2] }] }); // one bad paragraph rejects the list
    bad({
      received: Array.from({ length: 13 }, (_, i) => ({
        ...bare,
        source: `s${i}`,
      })),
    }); // past the ceiling
  });
});

describe("aperture — the feeding clock", () => {
  // The compendium's one moving part on a gu: a day and a period, which are a
  // PAIR. A lone hand is dropped (the document is worth more than one gu's
  // clock); a present hand is still held to its type.
  const held = (gu: Record<string, unknown>) =>
    withSealed({
      paths: [{ name: "Smithing", gu: [{ name: "Kiln gu", ...gu }] }],
    });
  const firstGu = (d: unknown) => normalizeAperture(d)?.sealed.paths[0].gu?.[0];

  it("accepts a whole clock, with and without a repo", () => {
    const clock = held({ fed: "2026-03-01", interval: 7 });
    expect(normalizeAperture(clock)).toEqual(clock);
    const fed = held({ fed: "2026-03-01", interval: 7, repo: "anthonyta" });
    expect(normalizeAperture(fed)).toEqual(fed);
  });

  it("keeps a repo with no clock — the push is then the only hand", () => {
    const repo = held({ repo: "anthonyta" });
    expect(normalizeAperture(repo)).toEqual(repo);
  });

  it("drops a lone hand rather than rejecting the whole document", () => {
    expect(firstGu(held({ fed: "2026-03-01" }))).toEqual({ name: "Kiln gu" });
    expect(firstGu(held({ interval: 7 }))).toEqual({ name: "Kiln gu" });
    // …and the rest of the document survives it untouched.
    expect(normalizeAperture(held({ interval: 7 }))?.sealed.trials).toEqual(
      doc.sealed.trials,
    );
  });

  it("normalizes a gu with no clock exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(firstGu(held({}))).toEqual({ name: "Kiln gu" });
  });

  it("hard-rejects a present-but-malformed hand", () => {
    const bad = (gu: Record<string, unknown>) =>
      expect(normalizeAperture(held(gu))).toBeNull();
    bad({ fed: "march", interval: 7 }); // not a day
    bad({ fed: "2026-03-01", interval: 0 }); // hungry the instant it was fed
    bad({ fed: "2026-03-01", interval: 1.5 }); // half a day is not a period
    bad({ fed: "2026-03-01", interval: 7, repo: "" }); // matches no push
  });
});

describe("aperture — gu held by no path", () => {
  // The compendium's second block: gu the house holds rather than a road.
  const gu = {
    name: "The portfolio",
    type: "wealth gu",
    fed: "2026-03-02",
    interval: 7,
  };

  it("accepts a list, and an empty one", () => {
    const one = withSealed({ held: [gu] });
    expect(normalizeAperture(one)).toEqual(one);
    const none = withSealed({ held: [] });
    expect(normalizeAperture(none)).toEqual(none);
  });

  it("normalizes a document without any exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("held");
  });

  it("drops an unknown key inside one", () => {
    const out = normalizeAperture(
      withSealed({ held: [{ ...gu, mutated: 1 }] }),
    );
    expect(out?.sealed.held).toEqual([gu]);
  });

  it("hard-rejects a present-but-malformed list", () => {
    const bad = (list: unknown) =>
      expect(normalizeAperture(withSealed({ held: list }))).toBeNull();
    bad("the portfolio"); // a word where a list should be
    bad([{ ...gu, name: 3 }]); // a gu has a name
    bad([{ ...gu, bears: "yes" }]); // one bad row rejects the list
    bad(Array.from({ length: 13 }, (_, i) => ({ name: `g${i}` }))); // past the ceiling
  });
});

describe("aperture — consumables", () => {
  // The burn allotment and what was burned against it. `stones` is cents, so
  // the frame holds it to whole non-negative numbers.
  const consumables = {
    budgetPct: 5,
    casts: [
      {
        date: "2026-03-02",
        name: "A month of the good coffee",
        stones: 4200,
        type: "comfort",
      },
      { date: "2026-02-14", name: "A day off the road" },
    ],
  };

  it("accepts a well-formed ledger, and an empty month", () => {
    const full = withSealed({ consumables });
    expect(normalizeAperture(full)).toEqual(full);
    const empty = withSealed({ consumables: { budgetPct: 0, casts: [] } });
    expect(normalizeAperture(empty)).toEqual(empty);
  });

  it("normalizes a document without any exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("consumables");
  });

  it("drops an unknown key inside a cast", () => {
    const out = normalizeAperture(
      withSealed({
        consumables: {
          budgetPct: 5,
          casts: [{ ...consumables.casts[0], mutated: 1 }],
        },
      }),
    );
    expect(out?.sealed.consumables?.casts).toEqual([consumables.casts[0]]);
  });

  it("hard-rejects a present-but-malformed ledger", () => {
    const bad = (v: unknown) =>
      expect(normalizeAperture(withSealed({ consumables: v }))).toBeNull();
    bad(5); // a number where the ledger should be
    bad({ budgetPct: 5 }); // the allotment alone is half a reading
    bad({ ...consumables, budgetPct: 101 }); // not a share of anything
    bad({ ...consumables, budgetPct: -1 });
    bad({ budgetPct: 5, casts: [{ date: "march", name: "x" }] }); // not a day
    bad({ budgetPct: 5, casts: [{ date: "2026-03-02", name: "" }] }); // unnamed
    bad({
      budgetPct: 5,
      casts: [{ date: "2026-03-02", name: "x", stones: -1 }],
    });
    bad({
      budgetPct: 5,
      casts: [{ date: "2026-03-02", name: "x", stones: 4.5 }],
    });
    bad({
      budgetPct: 5,
      casts: Array.from({ length: 61 }, () => ({
        date: "2026-03-02",
        name: "x",
      })),
    }); // past the ceiling
  });
});

describe("aperture — the refinement queue", () => {
  // The recipe book's open page: prose rows about gu NOT held.
  const entry = {
    name: "Chronicle gu",
    rank: "3",
    type: "record type",
    test: "a year of entries read back without a gap",
    needs: "a nightly hand",
  };

  it("accepts a queue, with and without what it needs", () => {
    const full = withSealed({ refining: [entry] });
    expect(normalizeAperture(full)).toEqual(full);
    const bare = withSealed({
      refining: [{ name: "a", rank: "1", type: "b", test: "c" }],
    });
    expect(normalizeAperture(bare)).toEqual(bare);
  });

  it("normalizes a document without one exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("refining");
  });

  it("drops an unknown key inside an entry", () => {
    const out = normalizeAperture(
      withSealed({ refining: [{ ...entry, mutated: 1 }] }),
    );
    expect(out?.sealed.refining).toEqual([entry]);
  });

  it("hard-rejects a present-but-malformed queue", () => {
    const bad = (v: unknown) =>
      expect(normalizeAperture(withSealed({ refining: v }))).toBeNull();
    bad("chronicle gu"); // a word where a list should be
    bad([{ ...entry, name: "" }]); // an entry either has a name or isn't one
    bad([{ ...entry, rank: "" }]);
    bad([{ ...entry, test: "" }]); // no test is no entry — the row's whole point
    bad([{ ...entry, needs: "" }]); // an empty line is malformed, not silence
    bad([{ ...entry, test: "x".repeat(401) }]); // past the prose ceiling
    bad(Array.from({ length: 25 }, (_, i) => ({ ...entry, name: `r${i}` }))); // past the ceiling
  });
});

describe("aperture — path peaks", () => {
  // How high a path goes, printed at the head of its card. Optional, and shared
  // with sub-paths by construction — `normPath` normalizes both.
  const peaked = withSealed({
    paths: [
      {
        name: "Smithing",
        peak: "R4 — a forge of its own, and apprentices working in it",
        sub: [
          { name: "Etching", peak: "R2 — plates a guild would hang unsigned" },
        ],
      },
    ],
  });

  it("accepts a peak on a path and on a sub-path", () => {
    expect(normalizeAperture(peaked)).toEqual(peaked);
  });

  it("normalizes a document carrying none exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed.paths[0]).not.toHaveProperty("peak");
    expect(out?.sealed.paths[1].sub?.[0]).not.toHaveProperty("peak");
  });

  it("hard-rejects a present-but-malformed peak, at either depth", () => {
    // An empty peak is absent-in-disguise: the card would draw "peak ·" and stop.
    const path = (patch: Record<string, unknown>) =>
      withSealed({ paths: [{ name: "Smithing", ...patch }] });
    expect(normalizeAperture(path({ peak: "" }))).toBeNull();
    expect(normalizeAperture(path({ peak: 3 }))).toBeNull();
    expect(normalizeAperture(path({ peak: null }))).toBeNull();
    expect(
      normalizeAperture(path({ sub: [{ name: "Etching", peak: "" }] })),
    ).toBeNull();
    expect(
      normalizeAperture(path({ sub: [{ name: "Etching", peak: 3 }] })),
    ).toBeNull();
  });
});

describe("aperture — the harvest and the rulings", () => {
  // The two sealed prose arrays: what the trials yielded, and the decisions the
  // check-in made. Both optional, so the fixture above is also their regression
  // case, and both capped — a runaway emission is a hard reject, not a slow page.
  const entry = {
    date: "2026-02-14",
    title: "the night of the cold forge",
    trial: "Winter crossing",
    body: [
      "**1. The bar pattern.** It held at every bar set in front of it.",
      "It did not hold where no bar had been set.",
    ],
  };
  const harvested = withSealed({
    enlightenments: [
      entry,
      { date: "2026-01-02", title: "second sight", body: ["one is enough."] },
    ],
    rulings: [
      {
        date: "2026-03-01",
        text: "the logbook streak counts the day it was written, not the day it was read.",
      },
    ],
  });

  it("accepts both arrays, parent trial and all", () => {
    expect(normalizeAperture(harvested)).toEqual(harvested);
  });

  it("accepts an entry that came out of no trial at all", () => {
    const out = normalizeAperture(
      withSealed({
        enlightenments: [
          { date: "2026-01-02", title: "on its own", body: ["…"] },
        ],
      }),
    );
    expect(out?.sealed.enlightenments?.[0]).not.toHaveProperty("trial");
  });

  it("normalizes a document carrying neither exactly as before", () => {
    const out = normalizeAperture(doc);
    expect(out).toEqual(doc);
    expect(out?.sealed).not.toHaveProperty("enlightenments");
    expect(out?.sealed).not.toHaveProperty("rulings");
  });

  it("drops an unknown key inside an entry and inside a ruling", () => {
    const out = normalizeAperture(
      withSealed({
        enlightenments: [{ ...entry, smuggled: "x" }],
        rulings: [{ date: "2026-03-01", text: "held.", smuggled: 1 }],
      }),
    );
    expect(out?.sealed.enlightenments).toEqual([entry]);
    expect(out?.sealed.rulings).toEqual([
      { date: "2026-03-01", text: "held." },
    ]);
  });

  it("hard-rejects a malformed enlightenment", () => {
    const bad = (patch: Record<string, unknown>) =>
      expect(
        normalizeAperture(
          withSealed({ enlightenments: [{ ...entry, ...patch }] }),
        ),
      ).toBeNull();
    bad({ date: "14 February 2026" }); // a date, but not a day
    bad({ date: "2026-02-14T09:00:00Z" }); // an instant, not a day
    bad({ date: undefined });
    bad({ title: "" });
    bad({ title: 3 });
    bad({ title: "x".repeat(201) });
    bad({ trial: 3 });
    bad({ body: undefined });
    bad({ body: [] }); // an entry with no body is not an entry
    bad({ body: "one paragraph" }); // a string is not a list of them
    bad({ body: ["fine", 3] });
    bad({ body: ["fine", ""] });
    bad({ body: ["x".repeat(4001)] });
    expect(normalizeAperture(withSealed({ enlightenments: {} }))).toBeNull();
  });

  it("hard-rejects a malformed ruling", () => {
    const bad = (ruling: unknown) =>
      expect(normalizeAperture(withSealed({ rulings: [ruling] }))).toBeNull();
    bad({ date: "2026-03-01" });
    bad({ date: "2026-03-01", text: "" });
    bad({ date: "2026-03-01", text: 3 });
    bad({ date: "2026-03-01", text: "x".repeat(4001) });
    bad({ date: "1 March 2026", text: "held." });
    bad("2026-03-01 · held.");
    expect(normalizeAperture(withSealed({ rulings: "held." }))).toBeNull();
  });

  it("accepts each list exactly at its ceiling and rejects one past it", () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: "2026-02-14",
        title: `entry ${i}`,
        body: ["yield."],
      }));
    const rulings = (n: number) =>
      Array.from({ length: n }, () => ({ date: "2026-03-01", text: "held." }));
    expect(
      normalizeAperture(withSealed({ enlightenments: entries(50) })),
    ).not.toBeNull();
    expect(
      normalizeAperture(withSealed({ enlightenments: entries(51) })),
    ).toBeNull();
    expect(
      normalizeAperture(withSealed({ rulings: rulings(30) })),
    ).not.toBeNull();
    expect(normalizeAperture(withSealed({ rulings: rulings(31) }))).toBeNull();

    const paragraphs = (n: number) => ({
      enlightenments: [
        { ...entry, body: Array.from({ length: n }, () => "p") },
      ],
    });
    expect(normalizeAperture(withSealed(paragraphs(60)))).not.toBeNull();
    expect(normalizeAperture(withSealed(paragraphs(61)))).toBeNull();
  });
});

describe("aperture — vocabulary openness", () => {
  // Unknown vocabulary renders MUTED — it is never dropped and never rejected.
  // The day the sync script learns a new status, tier, or rung, this build has
  // to keep rendering the module instead of blanking it.
  it("carries an unknown condition status through as a literal", () => {
    const out = normalizeAperture(
      withSealed({
        conditions: [{ ...doc.sealed.conditions[0], status: "transcended" }],
      }),
    );
    expect(out?.sealed.conditions[0].status).toBe("transcended");
    expect(isConditionStatus("transcended")).toBe(false);
  });

  it("carries an unknown attainment through on a path", () => {
    const out = normalizeAperture(
      withSealed({
        paths: [{ name: "Astronomy", attainment: "quasi-mythic" }],
      }),
    );
    expect(out?.sealed.paths[0].attainment).toBe("quasi-mythic");
    expect(isAttainment("quasi-mythic")).toBe(false);
  });

  it("carries an unknown trial tier through", () => {
    const out = normalizeAperture(
      withSealed({
        trials: [{ name: "Deep sounding", tier: "abyssal", state: "active" }],
      }),
    );
    expect(out?.sealed.trials[0].tier).toBe("abyssal");
    expect(isTrialTier("abyssal")).toBe(false);
  });

  it("keeps novel streak and strike-counter keys — the names are data", () => {
    const out = normalizeAperture(
      withSealed({
        streaks: {
          ...doc.sealed.streaks,
          moonwatch: { count: 1, target: 3, state: "kindling" },
        },
        breakthrough: {
          ...doc.sealed.breakthrough,
          recentStrikes: { petitions: 2, omens: 5 },
        },
      }),
    );
    expect(out?.sealed.streaks.moonwatch).toEqual({
      count: 1,
      target: 3,
      state: "kindling",
    });
    expect(out?.sealed.breakthrough.recentStrikes).toEqual({
      petitions: 2,
      omens: 5,
    });
  });
});

describe("aperture — vocabulary guards", () => {
  it("accept every member of their own closed vocabulary", () => {
    for (const s of ["initial", "middle", "upper", "peak"]) {
      expect(isApertureStage(s)).toBe(true);
    }
    for (const s of [
      "not_held",
      "hardening",
      "held",
      "hardened",
      "failing",
      "suspended",
    ]) {
      expect(isConditionStatus(s)).toBe(true);
    }
    for (const s of ["active", "stocked", "passed", "failed"]) {
      expect(isTrialState(s)).toBe(true);
    }
    for (const t of ["earthly", "heavenly", "grand"]) {
      expect(isTrialTier(t)).toBe(true);
    }
    for (const a of ATTAINMENTS) expect(isAttainment(a)).toBe(true);
  });

  it("reject a non-member and the empty string", () => {
    // A guard that said yes to "" would paint an unlabelled cell as known.
    expect(isApertureStage("apex")).toBe(false);
    expect(isApertureStage("")).toBe(false);
    expect(isConditionStatus("transcended")).toBe(false);
    expect(isConditionStatus("")).toBe(false);
    expect(isTrialState("pending")).toBe(false);
    expect(isTrialState("")).toBe(false);
    expect(isTrialTier("abyssal")).toBe(false);
    expect(isTrialTier("")).toBe(false);
    expect(isAttainment("quasi-mythic")).toBe(false);
    expect(isAttainment("")).toBe(false);
  });
});

describe("aperture — ATTAINMENTS", () => {
  it("lists the nine rungs lowest to highest", () => {
    // The order is load-bearing: the ladder renders in this sequence, so a
    // reshuffle would silently redraw the whole thing.
    expect(ATTAINMENTS).toEqual([
      "ordinary",
      "quasi-master",
      "master",
      "quasi-grandmaster",
      "grandmaster",
      "quasi-great-grandmaster",
      "great-grandmaster",
      "quasi-supreme-grandmaster",
      "supreme-grandmaster",
    ]);
    expect(ATTAINMENTS).toHaveLength(9);
    expect(ATTAINMENTS[0]).toBe("ordinary");
    expect(ATTAINMENTS.at(-1)).toBe("supreme-grandmaster");
  });
});

describe("aperture — freshness dots", () => {
  const SEALED_AT = "2026-03-05T00:00:00Z";
  const sealedMs = Date.parse(SEALED_AT);

  it("lights the adjudication dot at exactly two days of raw activity", () => {
    // A raw day parses as UTC midnight, so this pair is exactly 2 × 86_400_000
    // apart — the boundary itself, not a day either side of it.
    expect(Date.parse("2026-03-07") - sealedMs).toBe(2 * 86_400_000);
    expect(isAdjudicationPending(SEALED_AT, "2026-03-07")).toBe(true);
    expect(isAdjudicationPending(SEALED_AT, "2026-03-06")).toBe(false);
  });

  it("leaves the adjudication dot dark when there is no raw day at all", () => {
    expect(isAdjudicationPending(SEALED_AT, null)).toBe(false);
  });

  it("leaves the adjudication dot dark on an unparseable date", () => {
    // A broken date must never light a dot — a dot is a claim about reality.
    expect(isAdjudicationPending("whenever", "2026-03-07")).toBe(false);
    expect(isAdjudicationPending(SEALED_AT, "whenever")).toBe(false);
  });

  it("calls a seal stale only PAST nine days, never at nine", () => {
    expect(isSealStale(SEALED_AT, sealedMs + 9 * 86_400_000)).toBe(false);
    expect(isSealStale(SEALED_AT, sealedMs + 9 * 86_400_000 + 1)).toBe(true);
  });

  it("leaves the staleness dot dark on an unparseable seal", () => {
    expect(isSealStale("whenever", sealedMs + 40 * 86_400_000)).toBe(false);
  });
});

describe("aperture — normalizeApertureGlance", () => {
  it("accepts the plaintext glance", () => {
    expect(normalizeApertureGlance(glance)).toEqual(glance);
  });

  it("drops an unknown key", () => {
    const out = normalizeApertureGlance({ ...glance, smuggled: true });
    expect(out).toEqual(glance);
    expect(out).not.toHaveProperty("smuggled");
  });

  it("rejects a broken frame", () => {
    const { v, rank, stage } = glance;
    expect(normalizeApertureGlance({ ...glance, v: 2 })).toBeNull();
    expect(normalizeApertureGlance({ ...glance, rank: 0 })).toBeNull();
    expect(normalizeApertureGlance({ ...glance, rank: 2.5 })).toBeNull();
    expect(normalizeApertureGlance({ ...glance, stage: "" })).toBeNull();
    expect(normalizeApertureGlance({ v, rank, stage })).toBeNull();
  });
});
