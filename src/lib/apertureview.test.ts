import { describe, expect, it } from "vitest";
import {
  IMMORTAL_ESSENCE,
  MORTAL_ESSENCE,
  type AperturePath,
  type ApertureDoc,
  type ApertureTrial,
} from "./aperture";
import {
  ACTIVITY_SERIES,
  ESSENCE_SWATCH,
  ESSENCE_TEXT,
  bandLine,
  conditionChipClass,
  conditionChipPrefix,
  daysUntil,
  detailStatus,
  essenceSwatchClass,
  essenceTextClass,
  sealedAgo,
  splitTrials,
  trialCountdown,
  trialSchedule,
} from "./apertureview";

// These ARE the band + island's component tests. Nothing renders in this suite,
// because nothing in the components decides anything: the six island states, the
// colour of every chip and the wording of every date are the functions below, so
// testing them here is testing the UI itself (the money.tone / chores.choreState
// discipline). Every fixture is invented — this repo is public.

const NOW = Date.parse("2026-03-05T00:00:00Z");

/** A minimal well-formed document — `detailStatus` only asks whether one exists. */
const doc: ApertureDoc = {
  v: 1,
  sealedAt: "2026-03-05T00:00:00Z",
  public: { rank: 3, stage: "upper" },
  sealed: {
    streaks: {},
    conditions: [],
    paths: [],
    trials: [],
    breakthrough: { wall: "3→4", event: "", routes: [], recentStrikes: {} },
  },
};

const trial = (name: string, state: string): ApertureTrial => ({
  name,
  tier: "earthly",
  state,
});

describe("apertureview — detailStatus", () => {
  it("reaches all six states down the ladder", () => {
    expect(detailStatus("offline", null, null)).toBe("offline");
    expect(detailStatus("locked", null, null)).toBe("sealed");
    expect(detailStatus("unlocked", null, null)).toBe("decrypting");
    expect(detailStatus("unlocked", "unreachable", null)).toBe("unreachable");
    expect(detailStatus("unlocked", "tamper", null)).toBe("tamper");
    expect(detailStatus("unlocked", null, doc)).toBe("ready");
  });

  it("lets offline beat every other signal", () => {
    // With crypto off entirely there is nothing to unlock toward, so an error
    // from a previous session is not worth reporting.
    expect(detailStatus("offline", "tamper", doc)).toBe("offline");
    expect(detailStatus("offline", "unreachable", null)).toBe("offline");
  });

  it("ignores a data error while the vault isn't unlocked", () => {
    // A fetch that failed before the lock is a stale fact about a state the owner
    // has already left — it must not colour the sealed line red.
    for (const status of ["loading", "setup", "locked", "error"]) {
      expect(detailStatus(status, "unreachable", null)).toBe("sealed");
      expect(detailStatus(status, "tamper", doc)).toBe("sealed");
    }
  });

  it("prefers a decrypted document over a leftover error", () => {
    expect(detailStatus("unlocked", "unreachable", doc)).toBe("ready");
  });
});

describe("apertureview — essence classes", () => {
  const canon = [
    ...Object.values(MORTAL_ESSENCE).flatMap((byStage) =>
      Object.values(byStage),
    ),
    ...Object.values(IMMORTAL_ESSENCE),
  ];

  it("gives every one of the 24 canon names both a text and a swatch class", () => {
    // Iterating the canon tables rather than a copied list: the day a rank or
    // stage is added upstream, this test fails instead of the band rendering an
    // invisible name.
    expect(canon).toHaveLength(24);
    for (const name of canon) {
      expect(ESSENCE_TEXT[name], `${name} text class`).toBeTruthy();
      expect(ESSENCE_SWATCH[name], `${name} swatch class`).toBeTruthy();
      expect(essenceTextClass(name)).toBe(ESSENCE_TEXT[name]);
      expect(essenceSwatchClass(name)).toBe(ESSENCE_SWATCH[name]);
    }
  });

  it("maps each name to a distinct pair of literal classes", () => {
    expect(new Set(canon.map((n) => ESSENCE_TEXT[n])).size).toBe(24);
    expect(new Set(canon.map((n) => ESSENCE_SWATCH[n])).size).toBe(24);
    for (const name of canon) {
      expect(ESSENCE_TEXT[name].startsWith("text-")).toBe(true);
      expect(ESSENCE_SWATCH[name].startsWith("bg-")).toBe(true);
    }
  });

  it("mutes an unknown or absent name, and paints no swatch for it", () => {
    expect(essenceTextClass(null)).toBe("text-muted");
    expect(essenceTextClass("Moonstone")).toBe("text-muted");
    expect(essenceSwatchClass(null)).toBeNull();
    expect(essenceSwatchClass("Moonstone")).toBeNull();
  });
});

describe("apertureview — condition chips", () => {
  const statuses = [
    "not_held",
    "hardening",
    "held",
    "hardened",
    "failing",
    "suspended",
  ];

  it("gives each known status a chip class, five distinct tones", () => {
    // Five, not six: `suspended` deliberately SHARES the neutral chip with
    // `not_held` — see the never-red assertion below.
    const classes = statuses.map(conditionChipClass);
    for (const c of classes) expect(c).toBeTruthy();
    expect(new Set(classes).size).toBe(5);
    expect(conditionChipClass("failing")).toBe("border-down/50 text-down");
    expect(conditionChipClass("held")).toContain("text-up");
    expect(conditionChipClass("hardened")).toContain("text-up");
    expect(conditionChipClass("hardening")).toContain("text-amber");
  });

  it("NEVER paints a suspended condition red — the tribulation exemption", () => {
    // The rule as a test: a suspended condition was paused by the adjudicator,
    // not broken by the owner. Red would say failure, every time, wrongly.
    expect(conditionChipClass("suspended")).not.toContain("down");
    expect(conditionChipClass("suspended")).toBe("border-hairline text-muted");
    expect(conditionChipPrefix("suspended")).toBe("⏸ ");
  });

  it("prefixes nothing else", () => {
    for (const s of statuses) {
      if (s !== "suspended") expect(conditionChipPrefix(s)).toBe("");
    }
    expect(conditionChipPrefix("transcended")).toBe("");
  });

  it("mutes a status this build has never heard of", () => {
    expect(conditionChipClass("transcended")).toBe(
      "border-hairline text-muted",
    );
    expect(conditionChipClass("")).toBe("border-hairline text-muted");
  });
});

describe("apertureview — ACTIVITY_SERIES", () => {
  // The cartographer's paths, as the sealed document would carry them: two that
  // name a series the sheet can draw, one that names a series it has never heard
  // of, one that claims none at all.
  const paths: AperturePath[] = [
    { name: "Smithing", attainment: "master", activity: "commits" },
    { name: "Cartography", attainment: "quasi-master", activity: "languages" },
    { name: "Lodestone survey", activity: "tide-readings" },
    { name: "Winter provisioning" },
  ];

  it("gives every series it draws a source and a caption", () => {
    for (const [key, s] of Object.entries(ACTIVITY_SERIES)) {
      expect(s?.source, `${key} source`).toBeTruthy();
      expect(s?.label, `${key} label`).toBeTruthy();
    }
  });

  it("resolves the series a path names", () => {
    expect(ACTIVITY_SERIES[paths[0].activity ?? ""]?.source).toBe("github");
    expect(ACTIVITY_SERIES[paths[1].activity ?? ""]?.source).toBe("translator");
  });

  it("misses on a series this build has never heard of — no strip, no crash", () => {
    // The other half of lib/aperture's open-vocabulary bargain: a newer emitter
    // can attach any series it likes and the path still renders, bare.
    expect(ACTIVITY_SERIES[paths[2].activity ?? ""]).toBeUndefined();
    expect(ACTIVITY_SERIES[paths[3].activity ?? ""]).toBeUndefined();
    // Including the names every plain object inherits — the null prototype is
    // what makes those a miss instead of a function posing as a descriptor.
    expect(ACTIVITY_SERIES["toString"]).toBeUndefined();
    expect(ACTIVITY_SERIES["constructor"]).toBeUndefined();
  });

  it("is frozen — a table, not state", () => {
    expect(Object.isFrozen(ACTIVITY_SERIES)).toBe(true);
  });
});

describe("apertureview — daysUntil + trialSchedule", () => {
  it("rounds a countdown up and goes negative once past", () => {
    expect(daysUntil("2026-03-05T00:00:00Z", NOW)).toBe(0);
    expect(daysUntil("2026-03-05T12:00:00Z", NOW)).toBe(1);
    expect(daysUntil("2026-04-15T00:00:00Z", NOW)).toBe(41);
    expect(daysUntil("2026-03-01T00:00:00Z", NOW)).toBe(-4);
    expect(daysUntil("whenever", NOW)).toBeNull();
  });

  it("calls a date-less trial unscheduled", () => {
    expect(trialSchedule(null, NOW)).toBe("unscheduled");
    expect(trialSchedule(undefined, NOW)).toBe("unscheduled");
  });

  it("counts down to a future date", () => {
    expect(trialSchedule("2026-04-15", NOW)).toBe("in 41d");
    // The boundary: tomorrow reads "in 1d", never "in 0d".
    expect(trialSchedule("2026-03-06", NOW)).toBe("in 1d");
  });

  it("shows a resolved trial's own date instead of a countdown", () => {
    expect(trialSchedule("2026-03-05", NOW)).toBe("2026-03-05");
    expect(trialSchedule("2026-01-19", NOW)).toBe("2026-01-19");
  });

  it("passes an unparseable date through as the literal", () => {
    expect(trialSchedule("some winter", NOW)).toBe("some winter");
  });
});

describe("apertureview — trialCountdown", () => {
  // The sheet's sentence form, anchored on a Sydney calendar DAY rather than an
  // instant — the same 5 March as NOW above.
  const TODAY = "2026-03-05";

  it("says today for the day itself, at any hour of it", () => {
    expect(trialCountdown("2026-03-05", TODAY)).toBe("today");
    expect(trialCountdown("2026-03-05T23:30:00Z", TODAY)).toBe("today");
  });

  it("counts forward in whole days, singular at one", () => {
    expect(trialCountdown("2026-03-06", TODAY)).toBe("in 1 day");
    expect(trialCountdown("2026-03-07", TODAY)).toBe("in 2 days");
    expect(trialCountdown("2026-04-15", TODAY)).toBe("in 41 days");
  });

  it("counts a passed date backward instead of hiding it", () => {
    // A stocked trial whose day has gone by is still the owner's business: the row
    // says so rather than reading as unscheduled or as still ahead.
    expect(trialCountdown("2026-03-04", TODAY)).toBe("1 day ago");
    expect(trialCountdown("2026-01-19", TODAY)).toBe("45 days ago");
  });

  it("lands a small-hours timestamp on the calendar day it belongs to", () => {
    expect(trialCountdown("2026-03-04T02:00:00Z", TODAY)).toBe("1 day ago");
  });

  it("returns null for no date, and for anything unparseable at either end", () => {
    expect(trialCountdown(null, TODAY)).toBeNull();
    expect(trialCountdown(undefined, TODAY)).toBeNull();
    expect(trialCountdown("some winter", TODAY)).toBeNull();
    expect(trialCountdown("2026-04-15", "whenever")).toBeNull();
  });
});

describe("apertureview — splitTrials", () => {
  it("splits live from settled, keeping an unknown state open", () => {
    // An unrecognised state must NOT collapse behind the "+n resolved" toggle:
    // resolved trials hide, so hiding one would make it disappear.
    const trials = [
      trial("Winter crossing", "passed"),
      trial("Guild examination", "stocked"),
      trial("Deep sounding", "active"),
      trial("Harbour rites", "failed"),
      trial("Star reckoning", "deferred"),
    ];
    const { open, resolved } = splitTrials(trials);
    expect(open.map((t) => t.name)).toEqual([
      "Guild examination",
      "Deep sounding",
      "Star reckoning",
    ]);
    expect(resolved.map((t) => t.name)).toEqual([
      "Winter crossing",
      "Harbour rites",
    ]);
  });

  it("handles an empty list", () => {
    expect(splitTrials([])).toEqual({ open: [], resolved: [] });
  });
});

describe("apertureview — bandLine + sealedAgo", () => {
  it("uppercases the stage, known or not", () => {
    expect(
      bandLine({
        v: 1,
        sealedAt: "2026-03-05T00:00:00Z",
        rank: 3,
        stage: "upper",
      }),
    ).toBe("RANK 3 · UPPER");
    expect(
      bandLine({
        v: 1,
        sealedAt: "2026-03-05T00:00:00Z",
        rank: 6,
        stage: "transcendent",
      }),
    ).toBe("RANK 6 · TRANSCENDENT");
  });

  it("says today under a full day, then counts whole days", () => {
    expect(sealedAgo("2026-03-05T00:00:00Z", NOW)).toBe("sealed today");
    expect(sealedAgo("2026-03-04T01:00:00Z", NOW)).toBe("sealed today");
    expect(sealedAgo("2026-03-04T00:00:00Z", NOW)).toBe("sealed 1d ago");
    expect(sealedAgo("2026-03-02T00:00:00Z", NOW)).toBe("sealed 3d ago");
  });

  it("shows no age at all for an unparseable seal", () => {
    expect(sealedAgo("whenever", NOW)).toBeNull();
  });
});
