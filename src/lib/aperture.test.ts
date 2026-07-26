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
