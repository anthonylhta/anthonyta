import { describe, expect, it } from "vitest";
import {
  IMMORTAL_ESSENCE,
  MORTAL_ESSENCE,
  essenceOf,
  isAdjudicationPending,
  isSealStale,
  type AperturePath,
  type ApertureCondition,
  type ApertureDoc,
  type ApertureStreak,
  type ApertureTrial,
} from "./aperture";
import {
  ACTIVITY_SERIES,
  ESSENCE_TEXT,
  ESSENCE_VAR,
  ageOn,
  agoLabel,
  castReading,
  codeSpans,
  compactDollars,
  conditionChipClass,
  conditionChipPrefix,
  conditionStatusWord,
  conditionsSummary,
  dayGap,
  daysOpen,
  declaredSeriesKeys,
  detailStatus,
  essenceTextClass,
  essenceVarClass,
  familyOf,
  gutterPhrase,
  hardenLabel,
  hardenLines,
  imminentMajorTrial,
  isImminent,
  daoRows,
  evidenceDaysThisWeek,
  latestDailyDay,
  recordedDays,
  membraneOf,
  mortalSegments,
  pathAnchor,
  pathEvidence,
  sealedAgo,
  signedCount,
  splitLead,
  splitTrials,
  tierGlyph,
  trialCountdown,
  trialsSummary,
} from "./apertureview";

// These ARE the me-block + island's component tests. Nothing renders in this suite,
// because nothing in the components decides anything: the six island states, the
// colour of every chip, the wording of every date and every band's right-hand
// summary are the functions below, so testing them here is testing the UI itself
// (the money.tone / chores.choreState discipline). Every fixture is invented — this
// repo is public.

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

  it("gives every one of the 24 canon names a text and a var class", () => {
    // Iterating the canon tables rather than a copied list: the day a rank or
    // stage is added upstream, this test fails instead of the band rendering an
    // invisible name.
    expect(canon).toHaveLength(24);
    for (const name of canon) {
      expect(ESSENCE_TEXT[name], `${name} text class`).toBeTruthy();
      expect(ESSENCE_VAR[name], `${name} var class`).toBeTruthy();
      expect(essenceTextClass(name)).toBe(ESSENCE_TEXT[name]);
      expect(essenceVarClass(name)).toBe(ESSENCE_VAR[name]);
    }
  });

  it("maps each name to a distinct pair of literal classes", () => {
    expect(new Set(canon.map((n) => ESSENCE_TEXT[n])).size).toBe(24);
    expect(new Set(canon.map((n) => ESSENCE_VAR[n])).size).toBe(24);
    for (const name of canon) {
      expect(ESSENCE_TEXT[name].startsWith("text-")).toBe(true);
      // The var class DECLARES --essence over the same @theme token the text
      // class consumes — the skin's whole input, one line per canon name.
      expect(ESSENCE_VAR[name].startsWith("[--essence:var(--color-")).toBe(
        true,
      );
    }
  });

  it("mutes an unknown or absent name", () => {
    expect(essenceTextClass(null)).toBe("text-muted");
    expect(essenceTextClass("Moonstone")).toBe("text-muted");
    // Off canon the ESSENCE VARIABLE is muted too — the skin's chrome (gutters,
    // headers, washes) stays legible without inventing a colour.
    expect(essenceVarClass(null)).toBe("[--essence:var(--color-muted)]");
    expect(essenceVarClass("Moonstone")).toBe("[--essence:var(--color-muted)]");
  });
});

describe("apertureview — the skin's vocabulary (ADR 0118)", () => {
  it("names each mortal rank's essence family, and none above the ceiling", () => {
    expect(familyOf(1)).toEqual({ en: "Green Copper", zh: "青铜" });
    expect(familyOf(2)).toEqual({ en: "Red Steel", zh: "赤铁" });
    expect(familyOf(3)).toEqual({ en: "White Silver", zh: "白银" });
    expect(familyOf(4)).toEqual({ en: "Yellow Gold", zh: "黄金" });
    expect(familyOf(5)).toEqual({ en: "Purple Crystal", zh: "紫晶" });
    // Immortal essence has ONE name and essenceOf already returns it — a family
    // line would only repeat it, so there is none.
    for (const rank of [6, 7, 8, 9, 0, 10, 2.5, NaN])
      expect(familyOf(rank), `rank ${rank}`).toBeNull();
  });

  it("phrases the left gutter from the family, or not at all", () => {
    expect(gutterPhrase(1)).toBe("青铜之气");
    expect(gutterPhrase(5)).toBe("紫晶之气");
    expect(gutterPhrase(6)).toBeNull();
    expect(gutterPhrase(99)).toBeNull();
  });

  it("glyphs the three known trial tiers and stays silent on the rest", () => {
    expect(tierGlyph("earthly")).toBe("地");
    expect(tierGlyph("heavenly")).toBe("天");
    expect(tierGlyph("grand")).toBe("大");
    expect(tierGlyph("cosmic")).toBeNull();
    expect(tierGlyph("")).toBeNull();
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

  it("gives each known status a distinct chip class", () => {
    const classes = statuses.map(conditionChipClass);
    for (const c of classes) expect(c).toBeTruthy();
    expect(new Set(classes).size).toBe(6);
    expect(conditionChipClass("failing")).toBe("border-down/50 text-down");
    // The healthy ladder wears the sheet's essence variable (the cultivation
    // skin, ADR 0118), soft → full → full-with-wash as a condition hardens.
    expect(conditionChipClass("hardening")).toBe(
      "border-(--essence-soft) text-(--essence)",
    );
    expect(conditionChipClass("held")).toBe(
      "border-(--essence) text-(--essence)",
    );
    expect(conditionChipClass("hardened")).toBe(
      "border-(--essence) bg-(--essence-faint) text-(--essence)",
    );
  });

  it("NEVER paints a suspended condition red — the tribulation exemption", () => {
    // The rule as a test: a suspended condition was paused by the adjudicator, not
    // broken by the owner. Red would say failure, every time, wrongly. It is the one
    // status that speaks in SHAPE instead — a dashed border and the ⏸ prefix — so
    // its colour tokens are the neutral chip's, and nothing else.
    const chip = conditionChipClass("suspended");
    expect(chip).toBe("border-hairline border-dashed text-muted");
    expect(chip).not.toContain("down");
    expect(chip).not.toContain("up");
    expect(chip).not.toContain("amber");
    // …and not the essence either: the pause is the adjudicator's neutrality,
    // so it must not wear the healthy ladder's colour any more than red.
    expect(chip).not.toContain("essence");
    expect(conditionChipPrefix("suspended")).toBe("⏸ ");
  });

  it("respells the one snake_case status and no other", () => {
    expect(conditionStatusWord("not_held")).toBe("not held");
    for (const s of statuses)
      if (s !== "not_held") expect(conditionStatusWord(s)).toBe(s);
    expect(conditionStatusWord("transcended")).toBe("transcended");
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

describe("apertureview — conditionsSummary", () => {
  const cond = (status: string): ApertureCondition => ({
    id: status,
    label: status,
    status,
    progress: 0,
    target: 1,
    unit: "days",
  });

  it("leads with the worst thing, at most two segments", () => {
    // A header read before the chips are: leading with "2 hardening" while something
    // is failing buries the only line worth acting on.
    expect(
      conditionsSummary(
        ["hardening", "hardening", "not_held", "failing"].map(cond),
      ),
    ).toBe("1 failing · 2 hardening");
    expect(
      conditionsSummary(
        ["hardening", "held", "failing", "suspended"].map(cond),
      ),
    ).toBe("1 failing · 1 suspended");
    expect(conditionsSummary(["held", "hardened"].map(cond))).toBe(
      "1 held · 1 hardened",
    );
  });

  it("respells not_held and counts a single status alone", () => {
    expect(conditionsSummary([cond("not_held")])).toBe("1 not held");
    expect(conditionsSummary(["held", "held", "held"].map(cond))).toBe(
      "3 held",
    );
  });

  it("says nothing about no conditions", () => {
    expect(conditionsSummary([])).toBe("");
  });

  it("sorts an unknown status last but still names it when there is room", () => {
    // Abbreviating must never be how an unknown status disappears.
    expect(conditionsSummary(["transcended", "held"].map(cond))).toBe(
      "1 held · 1 transcended",
    );
    expect(conditionsSummary([cond("transcended")])).toBe("1 transcended");
    // …and when the known statuses fill both slots, the summary stops rather than
    // growing — the chips below still carry every condition.
    expect(
      conditionsSummary(["failing", "suspended", "transcended"].map(cond)),
    ).toBe("1 failing · 1 suspended");
  });
});

describe("apertureview — ACTIVITY_SERIES + pathEvidence", () => {
  // The cartographer's paths, as the sealed document would carry them: two that
  // name a series the sheet can draw, one that names a series it has never heard
  // of, one that claims none at all.
  const paths: AperturePath[] = [
    { name: "Smithing", attainment: "master", activity: "commits" },
    { name: "Cartography", attainment: "quasi-master", activity: "languages" },
    { name: "Lodestone survey", activity: "tide-readings" },
    { name: "Winter provisioning" },
  ];

  it("gives every series it draws a source, a caption, a mode and a unit", () => {
    for (const [key, s] of Object.entries(ACTIVITY_SERIES)) {
      expect(s?.source, `${key} source`).toBeTruthy();
      expect(s?.label, `${key} label`).toBeTruthy();
      expect(["delta", "count"], `${key} mode`).toContain(s?.mode);
      expect(typeof s?.unit, `${key} unit`).toBe("string");
    }
    // The two readings the band actually needs: a week's movement, and a day's count.
    expect(ACTIVITY_SERIES["commits"]?.mode).toBe("delta");
    expect(ACTIVITY_SERIES["steps"]?.mode).toBe("count");
    // A number that speaks for itself takes no unit — the strip's caption says it.
    expect(ACTIVITY_SERIES["languages"]?.unit).toBe("");
  });

  it("resolves the series a path names", () => {
    expect(ACTIVITY_SERIES[paths[0].activity ?? ""]?.source).toBe("github");
    expect(ACTIVITY_SERIES[paths[1].activity ?? ""]?.source).toBe("translator");
    expect(pathEvidence(paths[0])).toEqual({
      kind: "strip",
      key: "commits",
      series: ACTIVITY_SERIES["commits"],
    });
  });

  it("draws the sealed gym series as a week's movement", () => {
    // The first series the SERVER can't produce: its days are in the E2EE gym
    // envelope, so the island derives it and merges it into the evidence. Being
    // in this map is still what makes `activity: "gym"` drawable at all.
    expect(ACTIVITY_SERIES["gym"]?.mode).toBe("delta");
    expect(ACTIVITY_SERIES["gym"]?.unit).toBe("sessions");
    expect(pathEvidence({ name: "Body", activity: "gym" })).toEqual({
      kind: "strip",
      key: "gym",
      series: ACTIVITY_SERIES["gym"],
    });
  });

  it("draws the sealed meals series as the day's protein count", () => {
    // The second sealed series, on gym's terms — protein grams per day, read
    // like a step count rather than a week's movement.
    expect(ACTIVITY_SERIES["meals"]?.mode).toBe("count");
    expect(ACTIVITY_SERIES["meals"]?.unit).toBe("g");
    expect(pathEvidence({ name: "Meals", activity: "meals" })).toEqual({
      kind: "strip",
      key: "meals",
      series: ACTIVITY_SERIES["meals"],
    });
  });

  it("misses on a series this build has never heard of — no strip, no crash", () => {
    // The other half of lib/aperture's open-vocabulary bargain: a newer emitter
    // can attach any series it likes and the path still renders, bare.
    expect(ACTIVITY_SERIES[paths[2].activity ?? ""]).toBeUndefined();
    expect(ACTIVITY_SERIES[paths[3].activity ?? ""]).toBeUndefined();
    expect(pathEvidence(paths[2])).toBeNull();
    expect(pathEvidence(paths[3])).toBeNull();
    // Including the names every plain object inherits — the null prototype is
    // what makes those a miss instead of a function posing as a descriptor.
    expect(ACTIVITY_SERIES["toString"]).toBeUndefined();
    expect(ACTIVITY_SERIES["constructor"]).toBeUndefined();
    expect(pathEvidence({ name: "Ledger", activity: "toString" })).toBeNull();
  });

  it("collects the drawable series the paths declare, sub-paths included", () => {
    expect(declaredSeriesKeys(paths)).toEqual(
      new Set(["commits", "languages"]),
    );
    // A sub-path's declaration counts — the sheet reads the tree as siblings at
    // different depths, and a nested path's strip is drawn like any other.
    expect(
      declaredSeriesKeys([
        { name: "Body", sub: [{ name: "Strength", activity: "gym" }] },
      ]),
    ).toEqual(new Set(["gym"]));
    // Undrawable and absent names are not worth fetching for.
    expect(
      declaredSeriesKeys([{ name: "Tides", activity: "tide-readings" }]),
    ).toEqual(new Set());
    expect(declaredSeriesKeys([{ name: "Wealth" }])).toEqual(new Set());
    expect(declaredSeriesKeys([])).toEqual(new Set());
  });

  it("gives the wealth path the figure, declared or merely named", () => {
    // The one path recognised by NAME as well as by declaration: its figure comes
    // from the hub's own sealed envelope either way, so the row shows the money
    // whether or not the document thought to point at it.
    expect(pathEvidence({ name: "Wealth" })).toEqual({ kind: "wealth" });
    expect(pathEvidence({ name: "Coin", activity: "wealth" })).toEqual({
      kind: "wealth",
    });
    expect(pathEvidence({ name: " wealth " })).toEqual({ kind: "wealth" });
    // …and it does not swallow a path that merely mentions it.
    expect(pathEvidence({ name: "Wealth of the guild" })).toBeNull();
  });

  it("is frozen — a table, not state", () => {
    expect(Object.isFrozen(ACTIVITY_SERIES)).toBe(true);
  });
});

describe("apertureview — signedCount", () => {
  it("always signs a movement, including a flat week", () => {
    expect(signedCount(12)).toBe("+12");
    expect(signedCount(0)).toBe("+0");
    expect(signedCount(-3)).toBe("-3");
  });
});

describe("apertureview — pathAnchor", () => {
  it("slugs a path name the same way at both ends of the door", () => {
    expect(pathAnchor("craft")).toBe("craft");
    expect(pathAnchor("The Body")).toBe("the-body");
    expect(pathAnchor("  wealth  ")).toBe("wealth");
    // Any run of whitespace collapses to one dash — a double space in the
    // check-in's wording must not send the row at a card that doesn't exist.
    expect(pathAnchor(" Japanese\tlanguage  study ")).toBe(
      "japanese-language-study",
    );
  });
});

describe("apertureview — dayGap + isImminent", () => {
  const TODAY = "2026-03-05";

  it("counts whole calendar days either side of today", () => {
    expect(dayGap("2026-03-05", TODAY)).toBe(0);
    expect(dayGap("2026-03-05T23:30:00Z", TODAY)).toBe(0);
    expect(dayGap("2026-03-08", TODAY)).toBe(3);
    expect(dayGap("2026-03-01", TODAY)).toBe(-4);
    expect(dayGap("whenever", TODAY)).toBeNull();
    expect(dayGap("2026-03-08", "whenever")).toBeNull();
  });

  it("calls today and the coming week imminent, and nothing else", () => {
    expect(isImminent(TODAY, TODAY)).toBe(true);
    expect(isImminent("2026-03-08", TODAY)).toBe(true);
    expect(isImminent("2026-03-12", TODAY)).toBe(true); // the 7th day
    expect(isImminent("2026-03-13", TODAY)).toBe(false); // the 8th
    // A date already gone by is LATE, which the row says in words, not in amber.
    expect(isImminent("2026-03-04", TODAY)).toBe(false);
    expect(isImminent(null, TODAY)).toBe(false);
    expect(isImminent(undefined, TODAY)).toBe(false);
    expect(isImminent("some winter", TODAY)).toBe(false);
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

describe("apertureview — trialsSummary", () => {
  const TODAY = "2026-03-05";
  const dated = (
    name: string,
    state: string,
    date: string | null,
  ): ApertureTrial => ({ name, tier: "earthly", state, date });

  it("counts the states plainly when nothing is close", () => {
    expect(
      trialsSummary(
        [
          dated("Deep sounding", "active", null),
          dated("Ridge survey", "stocked", null),
        ],
        TODAY,
      ),
    ).toBe("1 active · 1 stocked");
    expect(trialsSummary([dated("Deep sounding", "active", null)], TODAY)).toBe(
      "1 active",
    );
  });

  it("lets a single imminent stocked trial read AS its countdown", () => {
    // With one there is nothing to count — the countdown is the whole news.
    expect(
      trialsSummary(
        [
          dated("Deep sounding", "active", null),
          dated("Ridge survey", "stocked", "2026-03-08"),
        ],
        TODAY,
      ),
    ).toBe("1 active · 1 in 3 days");
  });

  it("keeps the count and names the nearest when several are stocked", () => {
    expect(
      trialsSummary(
        [
          dated("Ridge survey", "stocked", "2026-03-09"),
          dated("Star reckoning", "stocked", "2026-03-07"),
        ],
        TODAY,
      ),
    ).toBe("2 stocked · next in 2 days");
  });

  it("ignores a distant or a passed date", () => {
    expect(
      trialsSummary([dated("Ridge survey", "stocked", "2026-06-01")], TODAY),
    ).toBe("1 stocked");
    // Late, not upcoming — the row says so in words; the header just counts it.
    expect(
      trialsSummary([dated("Ridge survey", "stocked", "2026-02-01")], TODAY),
    ).toBe("1 stocked");
    expect(
      trialsSummary([dated("Ridge survey", "stocked", "some winter")], TODAY),
    ).toBe("1 stocked");
  });

  it("tallies a state it has never heard of as open rather than losing it", () => {
    expect(
      trialsSummary(
        [
          dated("Deep sounding", "active", null),
          dated("Star reckoning", "deferred", null),
        ],
        TODAY,
      ),
    ).toBe("1 active · 1 open");
  });

  it("says nothing about no open trials", () => {
    expect(trialsSummary([], TODAY)).toBe("");
  });
});

describe("apertureview — imminentMajorTrial", () => {
  const TODAY = "2026-03-05";
  const tiered = (
    name: string,
    tier: string,
    state: string,
    date: string | null,
  ): ApertureTrial => ({ name, tier, state, date });

  it("escalates a heavenly or a grand trial inside the week", () => {
    const portage = tiered(
      "The long portage",
      "heavenly",
      "stocked",
      "2026-03-11",
    );
    expect(imminentMajorTrial([portage], TODAY)).toBe(portage);
    const sounding = tiered("Deep sounding", "grand", "stocked", TODAY);
    expect(imminentMajorTrial([sounding], TODAY)).toBe(sounding);
  });

  it("leaves an earthly trial to the band that already counts it down", () => {
    expect(
      imminentMajorTrial(
        [tiered("Ridge survey", "earthly", "stocked", "2026-03-08")],
        TODAY,
      ),
    ).toBeNull();
  });

  it("NEVER escalates a tier this build has never heard of", () => {
    // The one closed vocabulary in the module, and the reason: the dot claims
    // SEVERITY, and an unknown tier gives no grounds to claim it. The row still
    // prints the literal — unknown renders muted, not loud.
    expect(
      imminentMajorTrial(
        [tiered("Star reckoning", "cosmic", "stocked", "2026-03-08")],
        TODAY,
      ),
    ).toBeNull();
    expect(
      imminentMajorTrial(
        [tiered("Star reckoning", "", "stocked", TODAY)],
        TODAY,
      ),
    ).toBeNull();
  });

  it("ignores a major trial that is late, undated or unparseable", () => {
    // Already gone by is LATE, which the row says in words — the masthead only
    // ever shouts about what is still ahead.
    expect(
      imminentMajorTrial(
        [tiered("Charter defence", "heavenly", "stocked", "2026-03-04")],
        TODAY,
      ),
    ).toBeNull();
    expect(
      imminentMajorTrial(
        [tiered("Charter defence", "heavenly", "stocked", null)],
        TODAY,
      ),
    ).toBeNull();
    expect(
      imminentMajorTrial(
        [{ name: "Charter defence", tier: "heavenly", state: "stocked" }],
        TODAY,
      ),
    ).toBeNull();
    expect(
      imminentMajorTrial(
        [tiered("Charter defence", "heavenly", "stocked", "some winter")],
        TODAY,
      ),
    ).toBeNull();
    // The 8th day is outside the window, exactly as isImminent has it.
    expect(
      imminentMajorTrial(
        [tiered("Charter defence", "grand", "stocked", "2026-03-13")],
        TODAY,
      ),
    ).toBeNull();
  });

  it("takes the nearest of several, keeping document order on a tie", () => {
    const near = tiered("Ridge crossing", "grand", "stocked", "2026-03-07");
    const far = tiered("Charter defence", "heavenly", "stocked", "2026-03-10");
    expect(imminentMajorTrial([far, near], TODAY)).toBe(near);
    const first = tiered("First petition", "heavenly", "stocked", "2026-03-08");
    const second = tiered("Second petition", "grand", "stocked", "2026-03-08");
    expect(imminentMajorTrial([first, second], TODAY)).toBe(first);
  });

  it("escalates an active trial as readily as a stocked one", () => {
    // Both are OPEN, and so is a state this build has never heard of — the tier is
    // the closed vocabulary here, the state is not.
    const active = tiered(
      "Charter defence",
      "heavenly",
      "active",
      "2026-03-06",
    );
    expect(imminentMajorTrial([active], TODAY)).toBe(active);
    const deferred = tiered(
      "Star reckoning",
      "grand",
      "deferred",
      "2026-03-06",
    );
    expect(imminentMajorTrial([deferred], TODAY)).toBe(deferred);
  });

  it("says nothing about no trials at all", () => {
    expect(imminentMajorTrial([], TODAY)).toBeNull();
  });
});

describe("apertureview — membraneOf", () => {
  it("names the membrane over each of the four stages", () => {
    expect(membraneOf("initial")).toBe("light membrane");
    expect(membraneOf("middle")).toBe("water membrane");
    expect(membraneOf("upper")).toBe("stone membrane");
    expect(membraneOf("peak")).toBe("crystal");
  });

  it("names none for a stage this build has never heard of", () => {
    // The inward page's header omits the phrase rather than inventing a sheath —
    // including for every immortal rank, which is stageless by canon.
    expect(membraneOf("threshold")).toBeNull();
    expect(membraneOf("")).toBeNull();
    expect(membraneOf("INITIAL")).toBeNull(); // the vocabulary is lowercase
    expect(membraneOf("toString")).toBeNull(); // never a prototype member
  });
});

describe("apertureview — mortalSegments", () => {
  it("reads the day's small pursuits in order", () => {
    expect(
      mortalSegments({ riichiStreak: 4, tftGames: 3, readingDelta: 9 }),
    ).toEqual([
      { label: "riichi streak", value: "4" },
      { label: "tft", value: "+3" },
      { label: "reading", value: "+9", unit: "ch" },
    ]);
  });

  it("drops the reading segment rather than inventing a zero", () => {
    // No baseline to diff against yet — a "+0" the site made up is worse than a
    // shorter line.
    expect(
      mortalSegments({ riichiStreak: 0, tftGames: 0, readingDelta: null }),
    ).toEqual([
      { label: "riichi streak", value: "0" },
      { label: "tft", value: "+0" },
    ]);
  });

  it("signs a negative reading delta", () => {
    expect(
      mortalSegments({ riichiStreak: 11, tftGames: 1, readingDelta: -2 })[2],
    ).toEqual({ label: "reading", value: "-2", unit: "ch" });
  });
});

describe("apertureview — latestDailyDay", () => {
  it("finds the newest day-titled note and ignores every other title", () => {
    expect(
      latestDailyDay(
        ["2026-03-01", "Harbour survey notes", "2026-03-04", "2026-02-28"],
        "2026-03-05",
      ),
    ).toBe("2026-03-04");
  });

  it("returns null when no title is a day", () => {
    expect(latestDailyDay([], "2026-03-05")).toBeNull();
    expect(
      latestDailyDay(
        ["Harbour survey notes", "2026-3-4", "20260304"],
        "2026-03-05",
      ),
    ).toBeNull();
  });

  it("ignores pre-created day-planner notes for days that haven't happened", () => {
    expect(
      latestDailyDay(["2026-03-01", "2026-03-10", "2026-03-19"], "2026-03-05"),
    ).toBe("2026-03-01");
    expect(latestDailyDay(["2026-03-05"], "2026-03-05")).toBe("2026-03-05");
    expect(
      latestDailyDay(["2026-03-10", "2026-03-19"], "2026-03-05"),
    ).toBeNull();
  });
});

describe("apertureview — daoRows + evidenceDaysThisWeek", () => {
  it("collects marks-bearing nodes in reading order, names lowercased", () => {
    const rows = daoRows([
      {
        name: "Craft",
        activity: "commits",
        marks: { count: 1412, unit: "commit days" },
      },
      { name: "Quiet" },
      {
        name: "Body",
        sub: [
          {
            name: "Training",
            activity: "gym",
            marks: { count: 203, unit: "sessions" },
          },
          { name: "Walking", activity: "steps" },
        ],
      },
    ]);
    expect(rows).toEqual([
      { name: "craft", count: 1412, unit: "commit days", activity: "commits" },
      { name: "training", count: 203, unit: "sessions", activity: "gym" },
    ]);
  });

  it("a marks-bearing node with no activity gets a null lookup key", () => {
    expect(
      daoRows([{ name: "Ledgerless", marks: { count: 3, unit: "days" } }])[0]
        .activity,
    ).toBeNull();
  });

  it("counts nonzero days among the trailing seven only", () => {
    expect(evidenceDaysThisWeek([9, 9, 9, 1, 0, 2, 0, 3, 1, 0])).toBe(4);
    expect(evidenceDaysThisWeek([1, 2])).toBe(2);
    expect(evidenceDaysThisWeek([])).toBe(0);
  });
});

describe("apertureview — recordedDays", () => {
  it("counts distinct day-titled notes, ignoring every other title", () => {
    expect(
      recordedDays(
        ["2026-03-01", "Harbour survey notes", "2026-03-04", "2026-02-28"],
        "2026-03-05",
      ),
    ).toBe(3);
  });

  it("counts a duplicated day once — one lived day is one man soul", () => {
    expect(
      recordedDays(["2026-03-01", "2026-03-01", "2026-03-02"], "2026-03-05"),
    ).toBe(2);
  });

  it("never counts pre-created day-planner notes for days ahead", () => {
    expect(
      recordedDays(["2026-03-01", "2026-03-10", "2026-03-19"], "2026-03-05"),
    ).toBe(1);
    expect(recordedDays(["2026-03-05"], "2026-03-05")).toBe(1);
  });

  it("is zero on an empty or day-free vault", () => {
    expect(recordedDays([], "2026-03-05")).toBe(0);
    expect(
      recordedDays(["Harbour survey notes", "2026-3-4"], "2026-03-05"),
    ).toBe(0);
  });
});

describe("apertureview — sealedAgo", () => {
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

describe("apertureview — castReading", () => {
  // The killer-move band's one computation: a reading derived only from what
  // the declared evidence source actually holds.
  const ev = {
    recordTotal: 6,
    sealedAt: "2026-03-02T00:00:00Z",
    backupAt: "2026-02-21T00:00:00Z",
  };

  it("reads the record as a cast count aged by the current seal", () => {
    expect(castReading("record", ev, NOW)).toBe("cast 6 · 3d ago");
    expect(
      castReading("record", { ...ev, sealedAt: "2026-03-05T00:00:00Z" }, NOW),
    ).toBe("cast 6 · today");
  });

  it("drops the count on a dead listing rather than claiming zero casts", () => {
    expect(castReading("record", { ...ev, recordTotal: 0 }, NOW)).toBe(
      "3d ago",
    );
    expect(
      castReading("record", { ...ev, recordTotal: 0, sealedAt: "??" }, NOW),
    ).toBe("—");
  });

  it("reads the backup stamp as an age alone — casts stay uncounted", () => {
    expect(castReading("backup", ev, NOW)).toBe("12d ago");
    expect(castReading("backup", { ...ev, backupAt: null }, NOW)).toBe(
      "no record",
    );
  });

  it("switches to weeks past a fortnight, the agoLabel register", () => {
    expect(
      castReading("backup", { ...ev, backupAt: "2026-02-04T00:00:00Z" }, NOW),
    ).toBe("4w ago");
  });

  it("says so when a move leaves no trace", () => {
    expect(castReading(undefined, ev, NOW)).toBe("leaves no trace");
  });
});

describe("apertureview — codeSpans", () => {
  it("splits backtick pairs into chips and leaves prose literal", () => {
    expect(codeSpans("run `npm run hub-backup` first")).toEqual([
      { code: false, text: "run " },
      { code: true, text: "npm run hub-backup" },
      { code: false, text: " first" },
    ]);
  });

  it("passes a plain step through untouched", () => {
    expect(codeSpans("verify the printed counts")).toEqual([
      { code: false, text: "verify the printed counts" },
    ]);
  });

  it("keeps an unmatched final backtick as literal text", () => {
    expect(codeSpans("a `b")).toEqual([{ code: false, text: "a `b" }]);
    expect(codeSpans("`a` `b")).toEqual([
      { code: true, text: "a" },
      { code: false, text: " `b" },
    ]);
  });

  it("never emits an empty segment", () => {
    expect(codeSpans("``")).toEqual([]);
    expect(codeSpans("`npm run vault-sync`")).toEqual([
      { code: true, text: "npm run vault-sync" },
    ]);
  });
});

describe("apertureview — ageOn", () => {
  const BORN = "2001-08-19";

  it("counts the birthday itself, and not the day before", () => {
    // The whole reason this isn't a division: one is 24 ON the day, and 23 for
    // every day of the year leading up to it.
    expect(ageOn(BORN, "2026-08-18")).toBe(24);
    expect(ageOn(BORN, "2026-08-19")).toBe(25);
    expect(ageOn(BORN, "2026-08-20")).toBe(25);
  });

  it("holds the age across a year's turn", () => {
    expect(ageOn(BORN, "2026-01-01")).toBe(24);
    expect(ageOn(BORN, "2026-12-31")).toBe(25);
    expect(ageOn(BORN, BORN)).toBe(0);
  });

  it("gets the leap-year edge right", () => {
    // A February-29th birth day reads as not-yet-had in a common year, which is
    // the honest answer for a calendar with no such day in it — and exactly what
    // a milliseconds-over-365.25 age would get wrong.
    expect(ageOn("2004-02-29", "2026-02-28")).toBe(21);
    expect(ageOn("2004-02-29", "2026-03-01")).toBe(22);
    expect(ageOn("2004-02-29", "2024-02-29")).toBe(20);
  });

  it("refuses anything that isn't a calendar day", () => {
    expect(ageOn("19 August 2001", "2026-08-19")).toBeNull();
    expect(ageOn("2001-08-19T00:00:00Z", "2026-08-19")).toBeNull();
    expect(ageOn("2001-8-19", "2026-08-19")).toBeNull();
    expect(ageOn("2001-02-31", "2026-08-19")).toBeNull(); // shaped like a day
    expect(ageOn(BORN, "whenever")).toBeNull();
  });
});

describe("apertureview — daysOpen", () => {
  const TODAY = "2026-08-20";

  it("counts whole days since a trial was opened", () => {
    expect(daysOpen("2026-08-20", TODAY)).toBe("0d");
    expect(daysOpen("2026-08-19", TODAY)).toBe("1d");
    expect(daysOpen("2026-07-26", TODAY)).toBe("25d");
  });

  it("says nothing at all when there is no honest number to say", () => {
    expect(daysOpen(undefined, TODAY)).toBeNull();
    expect(daysOpen("last winter", TODAY)).toBeNull();
    // Opened tomorrow — a typo, not a trial that has been open for -1 days.
    expect(daysOpen("2026-08-21", TODAY)).toBeNull();
  });
});

describe("apertureview — agoLabel", () => {
  const TODAY = "2026-08-20";

  it("reads in days inside a fortnight and in weeks past it", () => {
    expect(agoLabel("2026-08-20", TODAY)).toBe("0d ago");
    expect(agoLabel("2026-08-07", TODAY)).toBe("13d ago");
    // The fortnight edge: the day it stops being a run of days.
    expect(agoLabel("2026-08-06", TODAY)).toBe("2w ago");
    expect(agoLabel("2026-07-17", TODAY)).toBe("4w ago");
    expect(agoLabel("2026-05-06", TODAY)).toBe("15w ago");
  });

  it("floors the weeks rather than rounding a week it hasn't finished", () => {
    expect(agoLabel("2026-08-02", TODAY)).toBe("2w ago"); // 18 days
    expect(agoLabel("2026-07-30", TODAY)).toBe("3w ago"); // 21 days
  });

  it("says nothing for a missing, broken or future date", () => {
    expect(agoLabel(null, TODAY)).toBeNull();
    expect(agoLabel(undefined, TODAY)).toBeNull();
    expect(agoLabel("some time back", TODAY)).toBeNull();
    expect(agoLabel("2026-08-21", TODAY)).toBeNull();
  });
});

describe("apertureview — hardenLabel + hardenLines", () => {
  const streak = (over: Partial<ApertureStreak>): ApertureStreak => ({
    count: 10,
    target: 12,
    state: "hardening",
    ...over,
  });

  it("reads a harden date in the meta line's register", () => {
    expect(hardenLabel("2026-08-12")).toBe("hardens ~aug 12");
    expect(hardenLabel("2026-12-01")).toBe("hardens ~dec 1");
    expect(hardenLabel("not-a-date")).toBeNull();
  });

  it("names each streak still working toward its target", () => {
    expect(
      hardenLines({
        finance: streak({ earliestHarden: "2026-08-30" }),
        logbook: streak({
          count: 40,
          target: 90,
          earliestHarden: "2026-09-02",
        }),
      }),
    ).toEqual(["finance · hardens ~aug 30", "logbook · hardens ~sep 2"]);
  });

  it("drops a streak that has already reached its target", () => {
    // The date is history once the count is there — the chip says "hardened".
    expect(
      hardenLines({
        finance: streak({ count: 12, earliestHarden: "2026-08-30" }),
      }),
    ).toEqual([]);
    expect(
      hardenLines({
        finance: streak({
          count: 97,
          target: 90,
          earliestHarden: "2026-08-30",
        }),
      }),
    ).toEqual([]);
  });

  it("drops a streak with no date, or one nobody can parse", () => {
    expect(hardenLines({ finance: streak({}) })).toEqual([]);
    expect(
      hardenLines({ finance: streak({ earliestHarden: "soon" }) }),
    ).toEqual([]);
    expect(hardenLines({})).toEqual([]);
  });

  it("keeps the emitter's own key order", () => {
    const lines = hardenLines({
      zeal: streak({ earliestHarden: "2026-09-09" }),
      finance: streak({ earliestHarden: "2026-08-30" }),
    });
    expect(lines).toEqual([
      "zeal · hardens ~sep 9",
      "finance · hardens ~aug 30",
    ]);
  });

  it("treats a streak named like an Object member as data", () => {
    expect(
      hardenLines({ toString: streak({ earliestHarden: "2026-08-30" }) }),
    ).toEqual(["toString · hardens ~aug 30"]);
  });
});

describe("apertureview — compactDollars", () => {
  it("reads whole dollars under a thousand and compacts above it", () => {
    expect(compactDollars(82_000)).toBe("$820");
    expect(compactDollars(0)).toBe("$0");
    expect(compactDollars(99_999)).toBe("$1000"); // $999.99, rounded
    expect(compactDollars(126_500)).toBe("$1.3k");
    expect(compactDollars(1_240_000)).toBe("$12.4k");
    expect(compactDollars(100_000_000)).toBe("$1.0M");
  });
});

describe("apertureview — splitLead", () => {
  it("reads a bold lead at the head of a paragraph", () => {
    expect(
      splitLead("**1. The bar pattern.** It held at every bar set for it."),
    ).toEqual({
      lead: "1. The bar pattern.",
      rest: " It held at every bar set for it.",
    });
  });

  it("keeps the separating space in the rest, so the halves rejoin", () => {
    const { lead, rest } = splitLead("**Lead.** Then the prose.");
    expect(`${lead}${rest}`).toBe("Lead. Then the prose.");
  });

  it("reads a paragraph that is nothing but its lead", () => {
    expect(splitLead("**All of it.**")).toEqual({
      lead: "All of it.",
      rest: "",
    });
  });

  it("finds no lead in an ordinary paragraph", () => {
    expect(splitLead("It did not hold where no bar had been set.")).toEqual({
      lead: null,
      rest: "It did not hold where no bar had been set.",
    });
    expect(splitLead("")).toEqual({ lead: null, rest: "" });
  });

  it("finds no lead when the emphasis is never closed", () => {
    // Half-written markup prints as it was written — the alternative is
    // swallowing the whole passage into an emphasis nobody opened.
    expect(splitLead("**unterminated, and the rest of it")).toEqual({
      lead: null,
      rest: "**unterminated, and the rest of it",
    });
    expect(splitLead("****")).toEqual({ lead: null, rest: "****" });
  });

  it("only reads emphasis at the START, and only once", () => {
    // Everything after the lead is prose the site prints literally — this is the
    // one piece of markup the harvest reads, not a markdown renderer.
    expect(splitLead("A sentence with **emphasis** inside it.")).toEqual({
      lead: null,
      rest: "A sentence with **emphasis** inside it.",
    });
    expect(splitLead("**Lead.** and **more** after.")).toEqual({
      lead: "Lead.",
      rest: " and **more** after.",
    });
  });
});

/**
 * The sheet in its three states, as the island would read them. Two whole documents
 * — a quiet week and a loud one — driven through every function the four bands call,
 * so a change to one summary's rule shows up here as the sheet reading differently
 * rather than as a passing unit test somewhere else. Both are the same invented
 * cartographer as aperture.test.ts, at the same rank.
 */
const CARTOGRAPHER_TODAY = "2026-03-05";

/** A quiet week: two streaks hardening, one condition failing quietly, nothing due. */
const quiet: ApertureDoc = {
  v: 1,
  sealedAt: "2026-03-03T09:00:00+11:00",
  public: { rank: 3, stage: "upper" },
  sealed: {
    streaks: {
      logbook: { count: 12, target: 60, state: "hardening" },
      ledger: { count: 6, target: 12, state: "hardening" },
    },
    conditions: [
      {
        id: "K1",
        label: "Logbook ≥60d",
        status: "hardening",
        progress: 12,
        target: 60,
        unit: "days",
      },
      {
        id: "K2",
        label: "Ledger ≥12w",
        status: "hardening",
        progress: 6,
        target: 12,
        unit: "weeks",
      },
      {
        id: "K3",
        label: "Stores ≥3mo",
        status: "not_held",
        progress: 0,
        target: 3,
        unit: "months",
      },
      {
        id: "K4",
        label: "Drill 4×/wk",
        status: "failing",
        progress: 2,
        target: 16,
        unit: "sessions",
      },
    ],
    paths: [
      {
        name: "Smithing",
        role: "main",
        attainment: "ordinary",
        note: "tempering",
        activity: "commits",
      },
      { name: "Wealth", role: "2nd", attainment: "ordinary" },
      { name: "Lodestone survey", role: "prot.", activity: "steps" },
      {
        name: "Cartography",
        role: "latent",
        sub: [
          {
            name: "Star charts",
            attainment: "quasi-master",
            verified: true,
            activity: "languages",
          },
        ],
      },
    ],
    vitalGu: { name: "Lodestone", rank: 1, max: 5 },
    trials: [
      {
        name: "Charter defence",
        tier: "heavenly",
        state: "active",
        opened: "2026-01-12",
      },
      { name: "Ridge survey", tier: "earthly", state: "stocked", date: null },
      {
        name: "Winter crossing",
        tier: "earthly",
        state: "passed",
        date: "2026-01-19",
      },
      {
        name: "Harbour rites",
        tier: "earthly",
        state: "failed",
        date: "2025-11-02",
      },
    ],
    breakthrough: {
      wall: "3 → 4",
      event: "first craft-earned essence",
      routes: ["signed charter", "first paid commission"],
      recentStrikes: { petitions: 0, commissions: 1 },
    },
  },
};

/** A loud week: a condition suspended under exemption, a trial three days out. */
const loud: ApertureDoc = {
  ...quiet,
  sealedAt: "2026-02-22T09:00:00+11:00",
  sealed: {
    ...quiet.sealed,
    conditions: [
      { ...quiet.sealed.conditions[0], progress: 54 },
      { ...quiet.sealed.conditions[1], status: "held", progress: 12 },
      { ...quiet.sealed.conditions[2], status: "failing" },
      { ...quiet.sealed.conditions[3], status: "suspended" },
    ],
    trials: [
      quiet.sealed.trials[0],
      { ...quiet.sealed.trials[1], date: "2026-03-08" },
      quiet.sealed.trials[2],
      quiet.sealed.trials[3],
      {
        name: "Deep sounding",
        tier: "grand",
        state: "passed",
        date: "2025-08-14",
      },
    ],
    breakthrough: {
      ...quiet.sealed.breakthrough,
      recentStrikes: { petitions: 4, commissions: 2 },
    },
  },
};

describe("apertureview — the sheet, locked", () => {
  it("never reaches a band, whatever the document says", () => {
    // Locked is ONE block naming the four bands, so no summary is computed at all:
    // every non-unlocked vault status collapses to the same sealed state.
    for (const status of ["loading", "setup", "locked", "error"])
      expect(detailStatus(status, null, quiet)).toBe("sealed");
    expect(detailStatus("offline", null, quiet)).toBe("offline");
  });
});

describe("apertureview — the sheet, a quiet week", () => {
  const { sealed } = quiet;
  const { open, resolved } = splitTrials(sealed.trials);

  it("heads the sea band with the essence and the stage's membrane", () => {
    // The sea band heads the inward page — the colour the rank names, then where
    // inside it one stands.
    expect(essenceOf(3, "upper")).toBe("Bright Silver");
    expect(essenceTextClass(essenceOf(3, "upper"))).toBe("text-bright-silver");
    expect(membraneOf("upper")).toBe("stone membrane");
  });

  it("summarises the bands", () => {
    expect(conditionsSummary(sealed.conditions)).toBe(
      "1 failing · 2 hardening",
    );
    expect(trialsSummary(open, CARTOGRAPHER_TODAY)).toBe(
      "1 active · 1 stocked",
    );
    expect(resolved).toHaveLength(2);
    expect(sealed.breakthrough.wall).toBe("3 → 4");
  });

  it("gives each path the evidence it declared, and the others none", () => {
    expect(sealed.paths.map((p) => pathEvidence(p)?.kind ?? null)).toEqual([
      "strip",
      "wealth",
      "strip",
      null,
    ]);
    expect(pathEvidence(sealed.paths[3].sub?.[0] as AperturePath)).toEqual({
      kind: "strip",
      key: "languages",
      series: ACTIVITY_SERIES["languages"],
    });
  });

  it("reads the stocked trial as unscheduled and shouts about nothing", () => {
    expect(trialCountdown(open[1].date, CARTOGRAPHER_TODAY)).toBeNull();
    for (const t of open)
      expect(isImminent(t.date, CARTOGRAPHER_TODAY)).toBe(false);
  });
});

describe("apertureview — the sheet, a loud week", () => {
  const { sealed } = loud;
  const { open, resolved } = splitTrials(sealed.trials);

  it("leads the conditions band with the failure and the exemption", () => {
    expect(conditionsSummary(sealed.conditions)).toBe(
      "1 failing · 1 suspended",
    );
    // …and the exemption is still never red, chip for chip.
    for (const c of sealed.conditions)
      if (c.status === "suspended")
        expect(conditionChipClass(c.status)).not.toContain("down");
  });

  it("counts down to the trial three days out", () => {
    expect(trialsSummary(open, CARTOGRAPHER_TODAY)).toBe(
      "1 active · 1 in 3 days",
    );
    expect(isImminent(open[1].date, CARTOGRAPHER_TODAY)).toBe(true);
    expect(trialCountdown(open[1].date, CARTOGRAPHER_TODAY)).toBe("in 3 days");
    expect(resolved).toHaveLength(3);
  });

  it("names both strike counters generically", () => {
    // The counter NAMES are data (an open record), so the band renders whatever the
    // document carries — it has no list of strikes it knows about.
    expect(Object.entries(sealed.breakthrough.recentStrikes)).toEqual([
      ["petitions", 4],
      ["commissions", 2],
    ]);
  });

  it("calls its own seal stale and the adjudication behind", () => {
    const now = Date.parse("2026-03-05T09:00:00+11:00");
    expect(sealedAgo(loud.sealedAt, now)).toBe("sealed 11d ago");
    expect(isSealStale(loud.sealedAt, now)).toBe(true);
    expect(
      isAdjudicationPending(
        loud.sealedAt,
        latestDailyDay(["2026-03-04", "Harbour survey notes"], "2026-03-05"),
      ),
    ).toBe(true);
  });
});
