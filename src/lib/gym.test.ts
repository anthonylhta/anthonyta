import { describe, expect, it } from "vitest";
import {
  EMPTY_GYM_CONFIG,
  EMPTY_GYM_DRAFT,
  GYM_MAX_BYTES,
  GYM_WEEKLY_TARGET,
  MAX_SESSIONS,
  addExercise,
  addSession,
  bestE1rm,
  bestFor,
  draftHasSets,
  draftToSession,
  e1rmSeries,
  epley,
  exerciseName,
  findExerciseByName,
  fitsGymCap,
  formatRest,
  gymPayloadBytes,
  isPr,
  liftChips,
  parseDraft,
  parseSetInput,
  plateauWeeks,
  prefillSet,
  lastDoneFor,
  lastSessionDate,
  lastSetsFor,
  normalizeGymConfig,
  removeSession,
  removeTemplate,
  renameExercise,
  restSeconds,
  sessionCounts,
  sessionDays,
  sessionVolume,
  sessionsThisWeek,
  templateName,
  upsertTemplate,
  weeklyVolume,
  type GymConfig,
  type GymSession,
} from "./gym";

const session = (over: Partial<GymSession> = {}): GymSession => ({
  id: "s1",
  date: "2026-07-20",
  entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 8 }] }],
  ...over,
});

/** A config with a catalog and one session, the shape most tests start from. */
const base = (over: Partial<GymConfig> = {}): GymConfig => ({
  v: 1,
  exercises: [
    { id: "bench", name: "bench press" },
    { id: "row", name: "row" },
  ],
  templates: [{ id: "t1", name: "upper", exerciseIds: ["bench", "row"] }],
  sessions: [session()],
  ...over,
});

describe("normalizeGymConfig", () => {
  it("round-trips a valid config", () => {
    const cfg = base();
    expect(normalizeGymConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });

  it("accepts the empty config", () => {
    expect(
      normalizeGymConfig({ v: 1, exercises: [], templates: [], sessions: [] }),
    ).toEqual(EMPTY_GYM_CONFIG);
  });

  it("carries seq through the rebuild and rejects an invalid one (58b)", () => {
    expect(normalizeGymConfig({ ...EMPTY_GYM_CONFIG, seq: 4 })).toEqual({
      ...EMPTY_GYM_CONFIG,
      seq: 4,
    });
    expect(normalizeGymConfig({ ...EMPTY_GYM_CONFIG, seq: -1 })).toBeNull();
    expect(normalizeGymConfig({ ...EMPTY_GYM_CONFIG, seq: 2.5 })).toBeNull();
  });

  it("keeps the optional session fields it was given", () => {
    const cfg = base({
      sessions: [session({ templateId: "t1", note: "felt strong" })],
    });
    const out = normalizeGymConfig(JSON.parse(JSON.stringify(cfg)));
    expect(out?.sessions[0].templateId).toBe("t1");
    expect(out?.sessions[0].note).toBe("felt strong");
  });

  it("rejects anything unrecognizable rather than degrading to empty", () => {
    expect(normalizeGymConfig(null)).toBeNull();
    expect(normalizeGymConfig("nope")).toBeNull();
    expect(normalizeGymConfig({ ...EMPTY_GYM_CONFIG, v: 2 })).toBeNull();
    expect(
      normalizeGymConfig({ v: 1, exercises: [], templates: [] }),
    ).toBeNull();
    expect(
      normalizeGymConfig({ ...EMPTY_GYM_CONFIG, sessions: [{}] }),
    ).toBeNull();
  });

  it("rejects a malformed date, set or entry", () => {
    expect(
      normalizeGymConfig(base({ sessions: [session({ date: "20/07/2026" })] })),
    ).toBeNull();
    expect(
      normalizeGymConfig(
        base({
          sessions: [
            session({
              entries: [{ exerciseId: "bench", sets: [{ w: -1, r: 8 }] }],
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      normalizeGymConfig(
        base({
          sessions: [
            session({
              entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 1.5 }] }],
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      normalizeGymConfig(
        base({
          sessions: [session({ entries: [{ exerciseId: "", sets: [] }] })],
        }),
      ),
    ).toBeNull();
  });

  it("rejects a config over the session cap", () => {
    const sessions = Array.from({ length: MAX_SESSIONS + 1 }, (_, i) =>
      session({ id: `s${i}` }),
    );
    expect(normalizeGymConfig(base({ sessions }))).toBeNull();
  });
});

describe("addSession", () => {
  it("prepends — the array stays newest-first by construction", () => {
    const cfg = addSession(base(), session({ id: "s2", date: "2026-07-22" }));
    expect(cfg.sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("prepends regardless of the date — nothing re-sorts", () => {
    // A backdated entry lands at the top because that is the order it was
    // written in; `date` is what the session says, not a sort key.
    const cfg = addSession(base(), session({ id: "s0", date: "2020-01-01" }));
    expect(cfg.sessions.map((s) => s.id)).toEqual(["s0", "s1"]);
  });

  it("is idempotent on id, so the 409 dance can re-run it", () => {
    const fresh = addSession(base(), session({ id: "s2" }));
    expect(addSession(fresh, session({ id: "s2" }))).toBe(fresh);
  });

  it("evicts the OLDEST session past the cap", () => {
    const sessions = Array.from({ length: MAX_SESSIONS }, (_, i) =>
      session({ id: `s${i}` }),
    );
    const cfg = addSession(base({ sessions }), session({ id: "new" }));
    expect(cfg.sessions.length).toBe(MAX_SESSIONS);
    expect(cfg.sessions[0].id).toBe("new");
    expect(cfg.sessions.some((s) => s.id === `s${MAX_SESSIONS - 1}`)).toBe(
      false,
    );
  });

  it("drops entries with no sets, and refuses a session left with nothing", () => {
    const cfg = addSession(
      base(),
      session({
        id: "s2",
        entries: [
          { exerciseId: "bench", sets: [{ w: 40, r: 10 }] },
          { exerciseId: "row", sets: [] },
        ],
      }),
    );
    expect(cfg.sessions[0].entries.map((e) => e.exerciseId)).toEqual(["bench"]);

    const empty = base();
    expect(
      addSession(
        empty,
        session({ id: "s3", entries: [{ exerciseId: "row", sets: [] }] }),
      ),
    ).toBe(empty);
  });

  it("carries seq through untouched (the writer bumps it, not the transform)", () => {
    const cfg = addSession(base({ seq: 7 }), session({ id: "s2" }));
    expect(cfg.seq).toBe(7);
  });
});

describe("removeSession", () => {
  it("removes by id and keeps the remaining order", () => {
    const cfg = addSession(base(), session({ id: "s2" }));
    const pruned = removeSession(cfg, "s1");
    expect(pruned.sessions.map((s) => s.id)).toEqual(["s2"]);
  });

  it("is a no-op identity on an unknown id, so the 409 dance can re-run it", () => {
    const cfg = base();
    expect(removeSession(cfg, "nope")).toBe(cfg);
  });

  it("carries seq through untouched (the writer bumps it, not the transform)", () => {
    const cfg = removeSession(base({ seq: 7 }), "s1");
    expect(cfg.seq).toBe(7);
  });
});

describe("addExercise", () => {
  it("appends to the catalog", () => {
    const cfg = addExercise(base(), "squat", "squat");
    expect(cfg.exercises.map((e) => e.name)).toEqual([
      "bench press",
      "row",
      "squat",
    ]);
  });

  it("trims the name and refuses an empty one", () => {
    expect(
      addExercise(EMPTY_GYM_CONFIG, "a", "  squat  ").exercises[0].name,
    ).toBe("squat");
    expect(addExercise(EMPTY_GYM_CONFIG, "a", "   ")).toBe(EMPTY_GYM_CONFIG);
  });

  it("is a no-op for an id or a name already present (re-runnable, dupe-proof)", () => {
    const cfg = base();
    expect(addExercise(cfg, "bench", "anything")).toBe(cfg);
    expect(addExercise(cfg, "other", "BENCH PRESS")).toBe(cfg);
    expect(addExercise(cfg, "other", "  row ")).toBe(cfg);
  });
});

describe("renameExercise", () => {
  it("renames in place and leaves the history pointing at it", () => {
    const cfg = renameExercise(base(), "bench", "barbell bench press");
    expect(exerciseName(cfg, "bench")).toBe("barbell bench press");
    expect(cfg.sessions[0].entries[0].exerciseId).toBe("bench");
  });

  it("ignores an unknown id and an empty name", () => {
    const cfg = base();
    expect(renameExercise(cfg, "nope", "x")).toBe(cfg);
    expect(renameExercise(cfg, "bench", "  ")).toBe(cfg);
  });
});

describe("upsertTemplate / removeTemplate", () => {
  it("appends a new template", () => {
    const cfg = upsertTemplate(base(), {
      id: "t2",
      name: "lower",
      exerciseIds: ["squat"],
    });
    expect(cfg.templates.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("replaces an existing id IN PLACE, keeping the owner's order", () => {
    const cfg = upsertTemplate(
      base({
        templates: [
          { id: "t1", name: "upper", exerciseIds: [] },
          { id: "t2", name: "lower", exerciseIds: [] },
        ],
      }),
      { id: "t1", name: "push", exerciseIds: ["bench"] },
    );
    expect(cfg.templates.map((t) => t.name)).toEqual(["push", "lower"]);
  });

  it("re-running the same upsert changes nothing further", () => {
    const tpl = { id: "t2", name: "lower", exerciseIds: ["squat"] };
    const once = upsertTemplate(base(), tpl);
    expect(upsertTemplate(once, tpl)).toEqual(once);
  });

  it("refuses an empty name; removes by id", () => {
    const cfg = base();
    expect(upsertTemplate(cfg, { id: "t9", name: " ", exerciseIds: [] })).toBe(
      cfg,
    );
    expect(removeTemplate(cfg, "t1").templates).toEqual([]);
  });

  it("names a template, or reports the honest miss", () => {
    expect(templateName(base(), "t1")).toBe("upper");
    expect(templateName(base(), "nope")).toBeNull();
  });
});

describe("findExerciseByName", () => {
  it("matches ignoring case and surrounding space", () => {
    expect(findExerciseByName(base(), " Bench Press ")).toBe("bench");
    expect(findExerciseByName(base(), "deadlift")).toBeNull();
    expect(findExerciseByName(base(), "  ")).toBeNull();
  });
});

describe("lastSetsFor / lastDoneFor", () => {
  const cfg = base({
    sessions: [
      session({
        id: "s3",
        date: "2026-07-24",
        entries: [{ exerciseId: "row", sets: [{ w: 40, r: 12 }] }],
      }),
      session({
        id: "s2",
        date: "2026-07-22",
        entries: [{ exerciseId: "bench", sets: [{ w: 65, r: 6 }] }],
      }),
      session({
        id: "s1",
        date: "2026-07-20",
        entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 8 }] }],
      }),
    ],
  });

  it("reads the most recent session containing the exercise", () => {
    expect(lastSetsFor(cfg, "bench")).toEqual([{ w: 65, r: 6 }]);
    expect(lastDoneFor(cfg, "bench")).toBe("2026-07-22");
  });

  it("skips a session that lists the exercise with no sets", () => {
    const withEmpty = base({
      sessions: [
        session({ id: "s4", entries: [{ exerciseId: "bench", sets: [] }] }),
        session({
          id: "s1",
          entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 8 }] }],
        }),
      ],
    });
    expect(lastSetsFor(withEmpty, "bench")).toEqual([{ w: 60, r: 8 }]);
  });

  it("is empty / null for an exercise never done", () => {
    expect(lastSetsFor(cfg, "squat")).toEqual([]);
    expect(lastDoneFor(cfg, "squat")).toBeNull();
  });
});

describe("bestFor / isPr", () => {
  const cfg = base({
    sessions: [
      session({
        id: "s2",
        entries: [
          {
            exerciseId: "bench",
            sets: [
              { w: 60, r: 10 },
              { w: 70, r: 3 },
            ],
          },
        ],
      }),
      session({
        id: "s1",
        entries: [{ exerciseId: "bench", sets: [{ w: 70, r: 5 }] }],
      }),
    ],
  });

  it("is the heaviest weight, and the most reps at that weight", () => {
    expect(bestFor(cfg, "bench")).toEqual({ w: 70, r: 5 });
  });

  it("is null for an exercise with no sets", () => {
    expect(bestFor(cfg, "row")).toBeNull();
  });

  it("flags a heavier set, and the same weight for more reps", () => {
    expect(isPr({ w: 72.5, r: 1 }, cfg, "bench")).toBe(true);
    expect(isPr({ w: 70, r: 6 }, cfg, "bench")).toBe(true);
  });

  it("does NOT flag equalling the best, or anything lighter", () => {
    expect(isPr({ w: 70, r: 5 }, cfg, "bench")).toBe(false);
    expect(isPr({ w: 70, r: 4 }, cfg, "bench")).toBe(false);
    expect(isPr({ w: 65, r: 20 }, cfg, "bench")).toBe(false);
  });

  it("never flags the FIRST set of an exercise — nothing to beat", () => {
    expect(isPr({ w: 100, r: 10 }, cfg, "squat")).toBe(false);
    expect(isPr({ w: 20, r: 1 }, EMPTY_GYM_CONFIG, "bench")).toBe(false);
  });
});

describe("sessionVolume", () => {
  it("sums weight × reps across every set", () => {
    expect(
      sessionVolume(
        session({
          entries: [
            {
              exerciseId: "bench",
              sets: [
                { w: 60, r: 8 },
                { w: 60, r: 8 },
              ],
            },
            { exerciseId: "row", sets: [{ w: 40, r: 10 }] },
          ],
        }),
      ),
    ).toBe(1360);
  });

  it("is zero for a bodyweight session (no weight to move)", () => {
    expect(
      sessionVolume(
        session({
          entries: [{ exerciseId: "pushup", sets: [{ w: 0, r: 20 }] }],
        }),
      ),
    ).toBe(0);
  });
});

describe("sessionCounts / sessionsThisWeek / sessionDays", () => {
  const cfg = base({
    sessions: [
      session({ id: "s3", date: "2026-07-26" }),
      session({ id: "s2", date: "2026-07-24" }),
      session({ id: "s1", date: "2026-07-10" }),
    ],
  });

  it("lists days in the array's own (newest-first) order", () => {
    expect(sessionDays(cfg)).toEqual([
      "2026-07-26",
      "2026-07-24",
      "2026-07-10",
    ]);
  });

  it("reads the last session's day off the head of the array", () => {
    expect(lastSessionDate(cfg)).toBe("2026-07-26");
    expect(lastSessionDate(EMPTY_GYM_CONFIG)).toBeNull();
  });

  it("windows oldest → newest, ending at today", () => {
    expect(sessionCounts(cfg, 4, "2026-07-26")).toEqual([0, 1, 0, 1]);
  });

  it("counts two sessions on the same day", () => {
    const twice = base({
      sessions: [
        session({ id: "a", date: "2026-07-26" }),
        session({ id: "b", date: "2026-07-26" }),
      ],
    });
    expect(sessionCounts(twice, 2, "2026-07-26")).toEqual([0, 2]);
  });

  it("counts the trailing 7 days INCLUDING today", () => {
    expect(sessionsThisWeek(cfg, "2026-07-26")).toBe(2);
    // 2026-07-20 back to 2026-07-14 — the 24th and 26th are ahead of it, the
    // 10th behind it, so a trailing week can read zero with sessions on both sides.
    expect(sessionsThisWeek(cfg, "2026-07-20")).toBe(0);
    expect(sessionsThisWeek(cfg, "2026-07-16")).toBe(1);
  });

  it("crosses a month boundary correctly", () => {
    const cross = base({
      sessions: [session({ id: "a", date: "2026-06-30" })],
    });
    expect(sessionsThisWeek(cross, "2026-07-02")).toBe(1);
    expect(sessionCounts(cross, 3, "2026-07-02")).toEqual([1, 0, 0]);
  });
});

describe("parseDraft", () => {
  it("round-trips a draft", () => {
    const draft = {
      templateId: "t1",
      entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 8 }] }],
      note: "hot",
    };
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("accepts a draft with no template", () => {
    expect(parseDraft(JSON.stringify(EMPTY_GYM_DRAFT))).toEqual(
      EMPTY_GYM_DRAFT,
    );
  });

  it("carries the rest stamp through, and drops a draft with a bad one", () => {
    const resting = { ...EMPTY_GYM_DRAFT, restAt: 1_770_000_000_000 };
    expect(parseDraft(JSON.stringify(resting))).toEqual(resting);
    expect(
      parseDraft(JSON.stringify({ ...EMPTY_GYM_DRAFT, restAt: -1 })),
    ).toBeNull();
    expect(
      parseDraft(JSON.stringify({ ...EMPTY_GYM_DRAFT, restAt: "soon" })),
    ).toBeNull();
  });

  it("drops an unparseable or foreign-shaped draft (a deploy mid-workout)", () => {
    expect(parseDraft("not json")).toBeNull();
    expect(parseDraft("null")).toBeNull();
    expect(parseDraft(JSON.stringify({ entries: [] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ entries: [{}], note: "" }))).toBeNull();
    expect(
      parseDraft(JSON.stringify({ entries: [], note: "x", templateId: "" })),
    ).toBeNull();
  });
});

describe("parseSetInput", () => {
  it("parses plain numbers", () => {
    expect(parseSetInput("50", false)).toBe(50);
    expect(parseSetInput("2.5", false)).toBe(2.5);
    expect(parseSetInput("8", true)).toBe(8);
  });

  it("holds an empty or mid-retype field as 0", () => {
    expect(parseSetInput("", false)).toBe(0);
    expect(parseSetInput("", true)).toBe(0);
    expect(parseSetInput(".", false)).toBe(0);
  });

  it("tolerates leading zeros without changing the value", () => {
    expect(parseSetInput("050", false)).toBe(50);
    expect(parseSetInput("007", true)).toBe(7);
  });

  it("accepts a trailing dot while a decimal is being typed", () => {
    expect(parseSetInput("60.", false)).toBe(60);
  });

  it("rejects anything that isn't a plain non-negative number", () => {
    expect(parseSetInput("-5", false)).toBeNull();
    expect(parseSetInput("abc", false)).toBeNull();
    expect(parseSetInput("1e3", false)).toBeNull();
    expect(parseSetInput("6 0", false)).toBeNull();
    expect(parseSetInput("2.5.5", false)).toBeNull();
    expect(parseSetInput("2.5", true)).toBeNull();
  });
});

describe("draftToSession / draftHasSets", () => {
  it("carries the template and a trimmed note", () => {
    const s = draftToSession(
      {
        templateId: "t1",
        entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 8 }] }],
        note: "  good day  ",
      },
      "s9",
      "2026-07-26",
    );
    expect(s).toEqual({
      id: "s9",
      date: "2026-07-26",
      templateId: "t1",
      entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 8 }] }],
      note: "good day",
    });
  });

  it("omits an empty note and an absent template entirely", () => {
    const s = draftToSession(
      { entries: [{ exerciseId: "bench", sets: [] }], note: "   " },
      "s9",
      "2026-07-26",
    );
    expect("note" in s).toBe(false);
    expect("templateId" in s).toBe(false);
  });

  it("knows whether there is anything worth saving", () => {
    expect(draftHasSets(EMPTY_GYM_DRAFT)).toBe(false);
    expect(
      draftHasSets({ entries: [{ exerciseId: "bench", sets: [] }], note: "" }),
    ).toBe(false);
    expect(
      draftHasSets({
        entries: [{ exerciseId: "bench", sets: [{ w: 0, r: 20 }] }],
        note: "",
      }),
    ).toBe(true);
  });
});

describe("restSeconds / formatRest", () => {
  it("counts whole seconds since the last set change", () => {
    expect(restSeconds(1_000, 1_000)).toBe(0);
    expect(restSeconds(1_000, 92_999)).toBe(91);
  });

  it("reads zero when the clock moved backwards under it", () => {
    expect(restSeconds(92_000, 1_000)).toBe(0);
  });

  it("formats m:ss, padding the seconds", () => {
    expect(formatRest(0)).toBe("0:00");
    expect(formatRest(9)).toBe("0:09");
    expect(formatRest(92)).toBe("1:32");
    expect(formatRest(600)).toBe("10:00");
  });

  it("stops climbing at 59:59 — an hour in, it is not a rest any more", () => {
    expect(formatRest(3599)).toBe("59:59");
    expect(formatRest(86_400)).toBe("59:59");
  });
});

describe("prefillSet", () => {
  const cfg = base({
    sessions: [
      session({
        entries: [
          {
            exerciseId: "bench",
            sets: [
              { w: 60, r: 8 },
              { w: 65, r: 5 },
            ],
          },
        ],
      }),
    ],
  });

  it("repeats the previous set in THIS session", () => {
    expect(prefillSet(cfg, "bench", [{ w: 50, r: 12 }])).toEqual({
      w: 50,
      r: 12,
    });
  });

  it("falls back to last time's corresponding set", () => {
    expect(prefillSet(cfg, "bench", [])).toEqual({ w: 60, r: 8 });
  });

  it("is zeroes for an exercise never done", () => {
    expect(prefillSet(cfg, "squat", [])).toEqual({ w: 0, r: 0 });
  });
});

describe("gymPayloadBytes / fitsGymCap", () => {
  it("measures the JSON as UTF-8 bytes", () => {
    expect(gymPayloadBytes(EMPTY_GYM_CONFIG)).toBe(
      JSON.stringify(EMPTY_GYM_CONFIG).length,
    );
  });

  it("accepts a real log and refuses one past the cap", () => {
    expect(fitsGymCap(base())).toBe(true);
    const huge = base({
      sessions: [session({ note: "x".repeat(GYM_MAX_BYTES) })],
    });
    expect(fitsGymCap(huge)).toBe(false);
  });
});

describe("epley / bestE1rm", () => {
  const cfg = base({
    sessions: [
      session({
        id: "s2",
        date: "2026-07-26",
        entries: [{ exerciseId: "bench", sets: [{ w: 100, r: 1 }] }],
      }),
      session({
        id: "s1",
        date: "2026-07-20",
        entries: [{ exerciseId: "bench", sets: [{ w: 90, r: 8 }] }],
      }),
    ],
  });

  it("returns a single untouched and estimates the rest", () => {
    expect(epley(100, 1)).toBe(100);
    expect(epley(100, 5)).toBeCloseTo(116.67, 2);
    expect(epley(65, 6)).toBe(78);
  });

  it("estimates nothing from no reps", () => {
    expect(epley(100, 0)).toBe(0);
    expect(epley(100, -1)).toBe(0);
  });

  it("picks the highest estimate, not the heaviest set", () => {
    // 90×8 (~114) is the harder lift; `bestFor` still names the 100 single.
    expect(bestE1rm(cfg, "bench")).toEqual({
      e1rm: 114,
      set: { w: 90, r: 8 },
      date: "2026-07-20",
    });
    expect(bestFor(cfg, "bench")).toEqual({ w: 100, r: 1 });
  });

  it("keeps the most recent of equal estimates", () => {
    const tied = base({
      sessions: [
        session({
          id: "s2",
          date: "2026-07-26",
          entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 10 }] }],
        }),
        session({
          id: "s1",
          date: "2026-07-20",
          entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 10 }] }],
        }),
      ],
    });
    expect(bestE1rm(tied, "bench")?.date).toBe("2026-07-26");
  });

  it("is null for an exercise with no sets", () => {
    expect(bestE1rm(cfg, "row")).toBeNull();
    expect(bestE1rm(EMPTY_GYM_CONFIG, "bench")).toBeNull();
  });
});

describe("liftChips", () => {
  const catalog = [
    { id: "bench", name: "bench press" },
    { id: "squat", name: "squat" },
    { id: "dead", name: "deadlift" },
    { id: "row", name: "row" },
  ];

  it("is empty with nothing logged", () => {
    expect(liftChips(EMPTY_GYM_CONFIG)).toEqual([]);
    expect(liftChips(base({ sessions: [] }))).toEqual([]);
  });

  it("ranks by estimate and omits lifts never done", () => {
    const cfg = base({
      exercises: catalog,
      sessions: [
        session({
          id: "s1",
          entries: [
            { exerciseId: "bench", sets: [{ w: 60, r: 8 }] }, // 76
            { exerciseId: "dead", sets: [{ w: 140, r: 1 }] }, // 140
            { exerciseId: "squat", sets: [{ w: 100, r: 5 }] }, // ~117
            { exerciseId: "row", sets: [] }, // never loaded — no chip
          ],
        }),
      ],
    });
    expect(liftChips(cfg)).toEqual([
      { id: "dead", name: "deadlift", e1rm: 140 },
      { id: "squat", name: "squat", e1rm: 117 },
      { id: "bench", name: "bench press", e1rm: 76 },
    ]);
  });

  it("breaks ties by name and caps the line", () => {
    const cfg = base({
      exercises: catalog,
      sessions: [
        session({
          id: "s1",
          entries: catalog.map((e) => ({
            exerciseId: e.id,
            sets: [{ w: 50, r: 5 }],
          })),
        }),
      ],
    });
    expect(liftChips(cfg).map((c) => c.name)).toEqual([
      "bench press",
      "deadlift",
      "row",
      "squat",
    ]);
    expect(liftChips(cfg, 2).map((c) => c.name)).toEqual([
      "bench press",
      "deadlift",
    ]);
  });

  it("carries the catalog id its own series can be read back with", () => {
    const cfg = base({
      exercises: catalog,
      sessions: [
        session({
          id: "s2",
          date: "2026-07-26",
          entries: [{ exerciseId: "bench", sets: [{ w: 65, r: 6 }] }], // 78
        }),
        session({
          id: "s1",
          date: "2026-07-20",
          entries: [{ exerciseId: "bench", sets: [{ w: 60, r: 8 }] }], // 76
        }),
      ],
    });
    const [chip] = liftChips(cfg);
    expect(chip.id).toBe("bench");
    expect(e1rmSeries(cfg, chip.id)).toEqual([76, 78]);
  });
});

describe("GYM_WEEKLY_TARGET", () => {
  it("is the cadence both surfaces read the week against", () => {
    expect(GYM_WEEKLY_TARGET).toBe(4);
  });
});

describe("e1rmSeries", () => {
  it("is the best estimate per session, oldest → newest", () => {
    const cfg = base({
      sessions: [
        session({
          id: "s4",
          entries: [{ exerciseId: "bench", sets: [] }],
        }),
        session({
          id: "s3",
          entries: [{ exerciseId: "bench", sets: [{ w: 70, r: 6 }] }],
        }),
        session({
          id: "s2",
          entries: [{ exerciseId: "row", sets: [{ w: 40, r: 10 }] }],
        }),
        session({
          id: "s1",
          entries: [
            {
              exerciseId: "bench",
              sets: [
                { w: 60, r: 8 },
                { w: 65, r: 6 },
              ],
            },
          ],
        }),
      ],
    });
    // 65×6 (78) beats 60×8 (76) within the session, and a setless session
    // contributes nothing at all.
    expect(e1rmSeries(cfg, "bench")).toEqual([78, 84]);
    expect(e1rmSeries(cfg, "squat")).toEqual([]);
  });
});

describe("plateauWeeks", () => {
  /** A bench day: one working set, the exercise the plateau tests read. */
  const bench = (id: string, date: string, w: number, r: number): GymSession =>
    session({ id, date, entries: [{ exerciseId: "bench", sets: [{ w, r }] }] });

  /** The best is the 100×5 on the 1st; three lighter days follow it. */
  const stalled = base({
    sessions: [
      bench("s4", "2026-07-25", 60, 8),
      bench("s3", "2026-07-18", 60, 8),
      bench("s2", "2026-07-10", 60, 8),
      bench("s1", "2026-07-01", 100, 5),
    ],
  });

  it("is null for a lift with no sets at all", () => {
    expect(plateauWeeks(stalled, "row", "2026-07-31")).toBeNull();
    expect(plateauWeeks(EMPTY_GYM_CONFIG, "bench", "2026-07-31")).toBeNull();
  });

  it("counts whole weeks since the best, once both conditions hold", () => {
    // 30 days since the 1st, and three sessions have trained it since.
    expect(plateauWeeks(stalled, "bench", "2026-07-31")).toBe(4);
  });

  it("stays silent when the lift simply hasn't been trained since", () => {
    const untrained = base({
      sessions: [
        bench("s4", "2026-07-25", 60, 8),
        // The exercise is in the session, but with nothing done: no training.
        session({
          id: "s3",
          date: "2026-07-18",
          entries: [{ exerciseId: "bench", sets: [] }],
        }),
        session({
          id: "s2",
          date: "2026-07-10",
          entries: [{ exerciseId: "row", sets: [{ w: 40, r: 10 }] }],
        }),
        bench("s1", "2026-07-01", 100, 5),
      ],
    });
    expect(plateauWeeks(untrained, "bench", "2026-07-31")).toBeNull();
  });

  it("stays silent inside the three-week window, however hard it is trained", () => {
    const recent = base({
      sessions: [
        bench("s6", "2026-07-21", 60, 8),
        bench("s5", "2026-07-19", 60, 8),
        bench("s4", "2026-07-17", 60, 8),
        bench("s3", "2026-07-15", 60, 8),
        bench("s2", "2026-07-13", 60, 8),
        bench("s1", "2026-07-11", 100, 5),
      ],
    });
    expect(plateauWeeks(recent, "bench", "2026-07-31")).toBeNull();
  });

  it("resets the clock when the best is matched again", () => {
    // `bestE1rm` keeps the most recent of equal estimates, so repeating the
    // ceiling re-dates it — holding a hard-won number is not stalling.
    const matched = base({
      sessions: [bench("s5", "2026-07-26", 100, 5), ...stalled.sessions],
    });
    expect(plateauWeeks(matched, "bench", "2026-07-31")).toBeNull();
  });

  it("counts only sessions dated strictly after the best", () => {
    const before = base({
      sessions: [
        bench("s4", "2026-07-25", 60, 8),
        bench("s3", "2026-07-10", 60, 8),
        // Same day as the best, and one before it — neither is "since".
        bench("s2", "2026-07-01", 60, 8),
        bench("s1", "2026-07-01", 100, 5),
        bench("s0", "2026-06-28", 60, 8),
      ],
    });
    expect(plateauWeeks(before, "bench", "2026-07-31")).toBeNull();
  });
});

describe("weeklyVolume", () => {
  const cfg = base({
    sessions: [
      session({
        id: "s4",
        date: "2026-07-26",
        entries: [{ exerciseId: "bench", sets: [{ w: 100, r: 5 }] }],
      }),
      session({
        id: "s3",
        date: "2026-07-20",
        entries: [{ exerciseId: "bench", sets: [{ w: 100, r: 2 }] }],
      }),
      session({
        id: "s2",
        date: "2026-07-19",
        entries: [{ exerciseId: "bench", sets: [{ w: 10, r: 3 }] }],
      }),
      session({
        id: "s1",
        date: "2026-07-06",
        entries: [{ exerciseId: "bench", sets: [{ w: 1, r: 7 }] }],
      }),
    ],
  });

  it("windows seven days at a time, oldest → newest, ending at today", () => {
    // 07-20 and 07-26 are the edges of the newest window; the 19th falls the
    // other side of that boundary, and the 6th is the far edge of the third.
    expect(weeklyVolume(cfg, 3, "2026-07-26")).toEqual([7, 30, 700]);
  });

  it("is exactly `weeks` long, with real zeros for untrained weeks", () => {
    expect(weeklyVolume(cfg, 5, "2026-07-26")).toEqual([0, 0, 7, 30, 700]);
    expect(weeklyVolume(EMPTY_GYM_CONFIG, 3, "2026-07-26")).toEqual([0, 0, 0]);
  });

  it("draws a hole where a week was skipped", () => {
    const gap = base({
      sessions: [
        session({
          id: "b",
          date: "2026-07-26",
          entries: [{ exerciseId: "bench", sets: [{ w: 100, r: 5 }] }],
        }),
        session({
          id: "a",
          date: "2026-07-06",
          entries: [{ exerciseId: "bench", sets: [{ w: 1, r: 7 }] }],
        }),
      ],
    });
    expect(weeklyVolume(gap, 3, "2026-07-26")).toEqual([7, 0, 500]);
  });

  it("drops sessions older than the oldest window", () => {
    const old = base({
      sessions: [
        session({
          id: "a",
          date: "2026-07-05",
          entries: [{ exerciseId: "bench", sets: [{ w: 100, r: 5 }] }],
        }),
      ],
    });
    expect(weeklyVolume(old, 3, "2026-07-26")).toEqual([0, 0, 0]);
    expect(weeklyVolume(old, 4, "2026-07-26")).toEqual([500, 0, 0, 0]);
  });

  it("crosses a month boundary correctly", () => {
    const cross = base({
      sessions: [
        session({
          id: "a",
          date: "2026-06-30",
          entries: [{ exerciseId: "bench", sets: [{ w: 20, r: 5 }] }],
        }),
      ],
    });
    expect(weeklyVolume(cross, 2, "2026-07-02")).toEqual([0, 100]);
  });
});
