import { describe, expect, it } from "vitest";
import { normalizeAperture, normalizeApertureGlance } from "./aperture";
import {
  apertureGlance,
  diffSummary,
  explainApertureRejection,
  sealDay,
} from "./aperturesync";

// Wholly invented status — this repo is public, so the fixture is fiction by
// construction and shares nothing with the real sealed blob but its SHAPE. Same
// cartographer as `aperture.test.ts`, so the two files read as one persona.
const raw = {
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
        label: "Morning pages",
        status: "hardening",
        progress: 12,
        target: 60,
        unit: "days",
      },
      {
        id: "K2",
        label: "Weekly review",
        status: "hardening",
        progress: 3,
        target: 8,
        unit: "weeks",
      },
    ],
    paths: [
      { name: "Smithing", role: "main", attainment: "quasi-master" },
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
        state: "active",
        date: "2026-04-19",
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

/** The fixture as a validated document — every test starts from the real gate, so
 *  a fixture that drifted out of frame fails loudly here instead of quietly
 *  exercising a shape the script could never be handed. */
function doc(patch: Record<string, unknown> = {}) {
  const next = normalizeAperture({ ...raw, ...patch });
  if (!next) throw new Error("fixture is not a valid aperture document");
  return next;
}

/** The fixture with its sealed block patched, then validated. */
function withSealed(patch: Record<string, unknown>) {
  return doc({ sealed: { ...raw.sealed, ...patch } });
}

describe("aperturesync — glance projection", () => {
  it("projects exactly the four fields the connector reads back", () => {
    // The read side is `normalizeApertureGlance`; this expectation is the write
    // side of that same contract, spelled out rather than derived.
    expect(apertureGlance(doc())).toEqual({
      v: 1,
      sealedAt: "2026-03-05T09:00:00+10:00",
      rank: 3,
      stage: "upper",
    });
  });

  it("survives the connector's own normalize round trip", () => {
    const glance = apertureGlance(doc());
    const roundTripped: unknown = JSON.parse(JSON.stringify(glance));
    expect(normalizeApertureGlance(roundTripped)).toEqual(glance);
  });

  it("leaks nothing sealed — no streak, condition, trial or path field", () => {
    // The glance is the ONE unsealed part of the status, so what it does NOT carry
    // is the actual invariant. Keys, not values: a future field added to the
    // projection has to come and argue with this test.
    expect(Object.keys(apertureGlance(doc())).sort()).toEqual([
      "rank",
      "sealedAt",
      "stage",
      "v",
    ]);
  });

  it("copies the document's seal instant rather than stamping a clock", () => {
    const shifted = doc({ sealedAt: "2026-02-01T07:30:00+10:00" });
    expect(apertureGlance(shifted).sealedAt).toBe("2026-02-01T07:30:00+10:00");
  });
});

describe("aperturesync — seal day", () => {
  it("reads a Sydney-offset instant as its own calendar day", () => {
    expect(sealDay("2026-03-05T09:00:00+10:00")).toBe("2026-03-05");
  });

  it("buckets a UTC evening on the Sydney day it lands in", () => {
    // 20:00Z on the 5th is already 06:00 on the 6th in Sydney (+10) — the exact
    // shift the UTC-day trap would archive under the wrong key (activity.ts's
    // lesson, 2026-07-03).
    expect(sealDay("2026-03-05T20:00:00Z")).toBe("2026-03-06");
  });

  it("keeps a bare date on that date", () => {
    // A bare day parses as UTC midnight = 10:00/11:00 Sydney the SAME day, so
    // an emitter that ever sealed with a plain date still archives sensibly.
    expect(sealDay("2026-07-28")).toBe("2026-07-28");
  });
});

describe("aperturesync — diff summary", () => {
  it("prints the whole snapshot on a first seal", () => {
    expect(diffSummary(null, doc())).toBe(
      "first seal · rank 3 · upper · 1 streak · 2 conditions · 2 paths · 1 trial · wall 3→4",
    );
  });

  it("says so plainly when a re-seal changed nothing", () => {
    expect(diffSummary(doc(), doc())).toBe(
      "rank unchanged (3 · upper) · nothing else changed",
    );
  });

  it("leads with the rank reading even when it hasn't moved", () => {
    const after = withSealed({
      streaks: { logbook: { ...raw.sealed.streaks.logbook, count: 14 } },
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · logbook 12→14",
    );
  });

  it("reports a breakthrough as a rank move", () => {
    const after = doc({ public: { rank: 4, stage: "initial" } });
    expect(diffSummary(doc(), after)).toBe("rank 3 · upper → 4 · initial");
  });

  it("names a new streak and a departed one", () => {
    const after = withSealed({
      streaks: { surveys: { count: 3, target: 30, state: "active" } },
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · surveys new (3) · logbook gone",
    );
  });

  it("names a condition status change by its label", () => {
    const after = withSealed({
      conditions: [
        raw.sealed.conditions[0],
        { ...raw.sealed.conditions[1], status: "held" },
      ],
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · conditions: 1 changed (Weekly review hardening→held)",
    );
  });

  it("counts added and removed conditions separately from changed ones", () => {
    const after = withSealed({
      conditions: [
        { ...raw.sealed.conditions[0], status: "hardened" },
        {
          id: "K3",
          label: "Ink stocktake",
          status: "not_held",
          progress: 0,
          target: 4,
          unit: "weeks",
        },
      ],
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · conditions: 1 changed (Morning pages hardening→hardened) · " +
        "conditions: +1 (Ink stocktake) · conditions: -1 (Weekly review)",
    );
  });

  it("counts a banked trial as an arrival in its state", () => {
    const after = withSealed({
      trials: [
        raw.sealed.trials[0],
        {
          name: "Guild examination",
          tier: "heavenly",
          state: "stocked",
          date: null,
          provisioned: true,
        },
      ],
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · trials: +1 stocked",
    );
  });

  it("names a trial that resolved", () => {
    const after = withSealed({
      trials: [{ ...raw.sealed.trials[0], state: "passed" }],
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · trials: Winter crossing active→passed",
    );
  });

  it("groups several arrivals by state and names departures", () => {
    const after = withSealed({
      trials: [
        { name: "Guild examination", tier: "heavenly", state: "stocked" },
        { name: "Ridge survey", tier: "earthly", state: "stocked" },
        { name: "Charter defence", tier: "grand", state: "active" },
      ],
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · trials: +2 stocked, +1 active · trials: -1 (Winter crossing)",
    );
  });

  it("reports every domain that moved in one line", () => {
    const after = doc({
      public: { rank: 3, stage: "peak" },
      sealed: {
        ...raw.sealed,
        streaks: { logbook: { ...raw.sealed.streaks.logbook, count: 19 } },
        conditions: [
          raw.sealed.conditions[0],
          { ...raw.sealed.conditions[1], status: "failing" },
        ],
        trials: [{ ...raw.sealed.trials[0], state: "passed" }],
      },
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank 3 · upper → 3 · peak · logbook 12→19 · " +
        "conditions: 1 changed (Weekly review hardening→failing) · " +
        "trials: Winter crossing active→passed",
    );
  });

  it("ignores a progress figure that moved without its status", () => {
    // Deliberate scope: progress is sealed and re-read in the panel seconds later,
    // so the summary stays quiet about it rather than mirroring the whole module.
    const after = withSealed({
      conditions: [
        { ...raw.sealed.conditions[0], progress: 40 },
        raw.sealed.conditions[1],
      ],
    });
    expect(diffSummary(doc(), after)).toBe(
      "rank unchanged (3 · upper) · nothing else changed",
    );
  });

  it("diffs a streak named after an Object.prototype member honestly", () => {
    // `toString` as a streak name would find the prototype's method on a bare
    // lookup and diff against its undefined count. The keys are data, so the name
    // is legal and the answer has to be "new (5)", not "undefined→5".
    const before = withSealed({ streaks: {} });
    const after = withSealed({
      streaks: { toString: { count: 5, target: 20, state: "active" } },
    });
    expect(diffSummary(before, after)).toBe(
      "rank unchanged (3 · upper) · toString new (5)",
    );
  });
});

describe("aperturesync — rejection diagnosis", () => {
  /** Every case here must ALSO be a real rejection: a diagnosis for a document the
   *  gate would have accepted is worse than no diagnosis at all. */
  function explainRejected(bad: unknown): string {
    expect(normalizeAperture(bad)).toBeNull();
    return explainApertureRejection(bad);
  }

  it("names a missing version", () => {
    const noVersion: Record<string, unknown> = { ...raw };
    delete noVersion.v;
    expect(explainRejected(noVersion)).toBe(
      "v must be exactly 1 (found nothing)",
    );
  });

  it("names a version this build doesn't know", () => {
    expect(explainRejected({ ...raw, v: 2 })).toBe(
      "v must be exactly 1 (found 2)",
    );
  });

  it("names an unparseable seal instant", () => {
    expect(explainRejected({ ...raw, sealedAt: "last tuesday" })).toBe(
      'sealedAt must be a date string an engine can parse (found "last tuesday")',
    );
  });

  it("names a rank that isn't a whole number", () => {
    expect(
      explainRejected({ ...raw, public: { rank: 3.5, stage: "upper" } }),
    ).toBe("public.rank must be a whole number of at least 1 (found 3.5)");
  });

  it("names a rank sent as a string", () => {
    expect(
      explainRejected({ ...raw, public: { rank: "3", stage: "upper" } }),
    ).toBe('public.rank must be a whole number of at least 1 (found "3")');
  });

  it("names an empty stage", () => {
    expect(explainRejected({ ...raw, public: { rank: 3, stage: "" } })).toBe(
      "public.stage must not be empty",
    );
  });

  it("names a mistyped streak count, with its streak", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        streaks: { logbook: { count: "12", target: 60, state: "active" } },
      },
    };
    expect(explainRejected(bad)).toBe(
      'sealed.streaks.logbook.count must be a finite number (found "12")',
    );
  });

  it("names a streaks block sent as an array", () => {
    const bad = { ...raw, sealed: { ...raw.sealed, streaks: [] } };
    expect(explainRejected(bad)).toBe(
      "sealed.streaks must be an object keyed by streak name (found an array)",
    );
  });

  it("names a condition status sent as a number, by row", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        conditions: [
          raw.sealed.conditions[0],
          { ...raw.sealed.conditions[1], status: 5 },
        ],
      },
    };
    expect(explainRejected(bad)).toBe(
      "sealed.conditions[1].status must be a non-empty string (found 5)",
    );
  });

  it("names a trial state left empty, by row", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        trials: [{ ...raw.sealed.trials[0], state: "" }],
      },
    };
    expect(explainRejected(bad)).toBe(
      "sealed.trials[0].state must not be empty",
    );
  });

  it("names a bad field inside a nested sub-path", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        paths: [
          raw.sealed.paths[0],
          {
            name: "Cartography",
            sub: [{ name: "Star charts", verified: "yes" }],
          },
        ],
      },
    };
    expect(explainRejected(bad)).toBe(
      'sealed.paths[1].sub[0].verified must be true or false (found "yes")',
    );
  });

  it("names a bad strike counter by its key", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        breakthrough: {
          ...raw.sealed.breakthrough,
          recentStrikes: { petitions: null },
        },
      },
    };
    expect(explainRejected(bad)).toBe(
      "sealed.breakthrough.recentStrikes.petitions must be a finite number (found null)",
    );
  });

  it("names a bad gu row by its path and index", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        paths: [
          {
            ...raw.sealed.paths[0],
            gu: [{ name: "Bellows" }, { name: "Quench trough", bears: "yes" }],
          },
          raw.sealed.paths[1],
        ],
      },
    };
    expect(explainRejected(bad)).toBe(
      'sealed.paths[0].gu[1].bears must be true or false (found "yes")',
    );
  });

  it("names a next-rung line sent as a number", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        paths: [{ ...raw.sealed.paths[0], next: 3 }, raw.sealed.paths[1]],
      },
    };
    expect(explainRejected(bad)).toBe(
      "sealed.paths[0].next must be a string (found 3)",
    );
  });

  it("names a bad vital-gu candidate by its index", () => {
    const bad = {
      ...raw,
      sealed: {
        ...raw.sealed,
        vitalGu: { name: "", rank: 0, max: 5, candidates: ["Lodestone", 3] },
      },
    };
    expect(explainRejected(bad)).toBe(
      "sealed.vitalGu.candidates[1] must be a string (found 3)",
    );
  });

  it("names a bad rented line by its index", () => {
    const bad = { ...raw, sealed: { ...raw.sealed, rented: [3] } };
    expect(explainRejected(bad)).toBe(
      "sealed.rented[0] must be a string (found 3)",
    );
  });

  it("names a present-but-malformed vital gu", () => {
    const bad = {
      ...raw,
      sealed: { ...raw.sealed, vitalGu: { name: "Lodestone", rank: 2 } },
    };
    expect(explainRejected(bad)).toBe(
      "sealed.vitalGu.max must be a finite number (found nothing)",
    );
  });

  it("names a missing sealed block", () => {
    const noSealed: Record<string, unknown> = { ...raw };
    delete noSealed.sealed;
    expect(explainRejected(noSealed)).toBe(
      "sealed must be an object (found nothing)",
    );
  });

  it("rejects a document that isn't an object at all", () => {
    expect(explainRejected(null)).toBe(
      "the document must be a JSON object (found null)",
    );
    expect(explainRejected([raw])).toBe(
      "the document must be a JSON object (found an array)",
    );
    expect(explainRejected("aperture")).toBe(
      'the document must be a JSON object (found "aperture")',
    );
  });

  it("never blames an open vocabulary value", () => {
    // A stage, status, tier or rung this build has never heard of is VALID — the
    // frame is strict, the vocabulary open. So there is nothing to diagnose, and
    // the guard here is that the gate itself accepts the document.
    const unheardOf = {
      ...raw,
      public: { rank: 3, stage: "threshold" },
      sealed: {
        ...raw.sealed,
        conditions: [
          { ...raw.sealed.conditions[0], status: "quarantined" },
          raw.sealed.conditions[1],
        ],
        trials: [{ ...raw.sealed.trials[0], tier: "sovereign" }],
      },
    };
    expect(normalizeAperture(unheardOf)).not.toBeNull();
  });

  it("falls back honestly when it cannot pin a field", () => {
    // The walk duplicates lib/aperture's predicates, so it can drift behind the
    // gate. When it finds nothing it must say so rather than invent a culprit —
    // this fixture is well-formed, standing in for a future rule the walk lacks.
    expect(explainApertureRejection(raw)).toContain("no single field could be");
  });
});
