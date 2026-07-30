import { describe, expect, it } from "vitest";
import {
  EMPTY_GYM_CONFIG,
  EMPTY_GYM_DRAFT,
  GYM_MAX_BYTES,
  MAX_SESSIONS,
  addExercise,
  addSession,
  bestFor,
  draftHasSets,
  draftToSession,
  exerciseName,
  findExerciseByName,
  fitsGymCap,
  gymPayloadBytes,
  isPr,
  parseDraft,
  parseSetInput,
  prefillSet,
  lastDoneFor,
  lastSetsFor,
  normalizeGymConfig,
  removeSession,
  removeTemplate,
  renameExercise,
  sessionCounts,
  sessionDays,
  sessionVolume,
  sessionsThisWeek,
  templateName,
  topSetSeries,
  upsertTemplate,
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

describe("topSetSeries", () => {
  it("is the heaviest set per session, oldest → newest", () => {
    const cfg = base({
      sessions: [
        session({
          id: "s3",
          entries: [{ exerciseId: "bench", sets: [{ w: 70, r: 5 }] }],
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
    expect(topSetSeries(cfg, "bench")).toEqual([65, 70]);
    expect(topSetSeries(cfg, "squat")).toEqual([]);
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
