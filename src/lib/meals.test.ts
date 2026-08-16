import { describe, expect, it } from "vitest";
import {
  EMPTY_MEALS_CONFIG,
  MAX_ENTRIES,
  MEALS_MAX_BYTES,
  addEntry,
  addFood,
  ageLabel,
  bucketFoods,
  dayHeading,
  dayTotals,
  daysSinceYmd,
  entriesFor,
  nextDay,
  prevDay,
  fitsMealsCap,
  foodName,
  foodUsage,
  matchFoods,
  matchIndex,
  mealsPayloadBytes,
  rankFoods,
  normalizeMealsConfig,
  parseMacroInput,
  parseQtyInput,
  removeEntry,
  removeFood,
  setTargets,
  trailingProtein,
  updateFood,
  type MealsConfig,
  type MealsEntry,
  type MealsFood,
} from "./meals";

const food = (over: Partial<MealsFood> = {}): MealsFood => ({
  id: "rice",
  name: "rice (bowl)",
  kcal: 200,
  p: 4,
  c: 44,
  f: 1,
  ...over,
});

const entry = (over: Partial<MealsEntry> = {}): MealsEntry => ({
  id: "e1",
  date: "2026-07-20",
  foodId: "rice",
  qty: 1,
  ...over,
});

/** A config with a small library and one entry, the shape most tests start from. */
const base = (over: Partial<MealsConfig> = {}): MealsConfig => ({
  v: 1,
  foods: [
    food(),
    food({
      id: "chicken",
      name: "chicken thigh",
      kcal: 220,
      p: 26,
      c: 0,
      f: 13,
    }),
  ],
  entries: [entry()],
  ...over,
});

describe("normalizeMealsConfig", () => {
  it("round-trips a valid config", () => {
    const cfg = base();
    expect(normalizeMealsConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });

  it("accepts the empty config", () => {
    expect(normalizeMealsConfig({ v: 1, foods: [], entries: [] })).toEqual(
      EMPTY_MEALS_CONFIG,
    );
  });

  it("carries seq through the rebuild and rejects an invalid one (58b)", () => {
    expect(normalizeMealsConfig({ ...EMPTY_MEALS_CONFIG, seq: 4 })).toEqual({
      ...EMPTY_MEALS_CONFIG,
      seq: 4,
    });
    expect(normalizeMealsConfig({ ...EMPTY_MEALS_CONFIG, seq: -1 })).toBeNull();
    expect(
      normalizeMealsConfig({ ...EMPTY_MEALS_CONFIG, seq: 2.5 }),
    ).toBeNull();
  });

  it("carries targets when set, omits the key when they aren't", () => {
    const targets = { kcal: 2200, p: 140, c: 220, f: 70 };
    expect(normalizeMealsConfig({ ...EMPTY_MEALS_CONFIG, targets })).toEqual({
      ...EMPTY_MEALS_CONFIG,
      targets,
    });
    expect("targets" in normalizeMealsConfig(EMPTY_MEALS_CONFIG)!).toBe(false);
  });

  it("rejects malformed targets rather than dropping them silently", () => {
    expect(
      normalizeMealsConfig({
        ...EMPTY_MEALS_CONFIG,
        targets: { kcal: 2200, p: 140, c: 220 },
      }),
    ).toBeNull();
    expect(
      normalizeMealsConfig({
        ...EMPTY_MEALS_CONFIG,
        targets: { kcal: 2200, p: -1, c: 220, f: 70 },
      }),
    ).toBeNull();
  });

  it("rejects anything unrecognizable rather than degrading to empty", () => {
    expect(normalizeMealsConfig(null)).toBeNull();
    expect(normalizeMealsConfig("nope")).toBeNull();
    expect(normalizeMealsConfig({ ...EMPTY_MEALS_CONFIG, v: 2 })).toBeNull();
    expect(normalizeMealsConfig({ v: 1, foods: [] })).toBeNull();
    expect(
      normalizeMealsConfig({ ...EMPTY_MEALS_CONFIG, entries: [{}] }),
    ).toBeNull();
  });

  it("rejects a malformed food or entry", () => {
    expect(
      normalizeMealsConfig(base({ foods: [food({ name: "" })] })),
    ).toBeNull();
    expect(normalizeMealsConfig(base({ foods: [food({ p: -1 })] }))).toBeNull();
    expect(
      normalizeMealsConfig(base({ entries: [entry({ date: "20/07/2026" })] })),
    ).toBeNull();
    expect(
      normalizeMealsConfig(base({ entries: [entry({ qty: 0 })] })),
    ).toBeNull();
    expect(
      normalizeMealsConfig(base({ entries: [entry({ foodId: "" })] })),
    ).toBeNull();
  });

  it("accepts a food's usage counters, present or absent", () => {
    const counted = base({
      foods: [food({ uses: 12, lastUsed: "2026-07-20" })],
    });
    expect(normalizeMealsConfig(JSON.parse(JSON.stringify(counted)))).toEqual(
      counted,
    );
    // Absent is the shape every food had before the counters existed.
    expect("uses" in normalizeMealsConfig(base())!.foods[0]).toBe(false);
  });

  it("rejects a broken counter rather than dropping it", () => {
    expect(
      normalizeMealsConfig(base({ foods: [food({ uses: -1 })] })),
    ).toBeNull();
    expect(
      normalizeMealsConfig(base({ foods: [food({ uses: 1.5 })] })),
    ).toBeNull();
    expect(
      normalizeMealsConfig(base({ foods: [food({ lastUsed: "20/07/2026" })] })),
    ).toBeNull();
  });

  it("rejects a config over the entry cap", () => {
    const entries = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) =>
      entry({ id: `e${i}` }),
    );
    expect(normalizeMealsConfig(base({ entries }))).toBeNull();
  });
});

describe("addFood", () => {
  it("appends to the library, trimming the name", () => {
    const cfg = addFood(base(), food({ id: "oats", name: "  oats (cup) " }));
    expect(cfg.foods.map((f) => f.name)).toEqual([
      "rice (bowl)",
      "chicken thigh",
      "oats (cup)",
    ]);
  });

  it("refuses an empty name", () => {
    expect(addFood(EMPTY_MEALS_CONFIG, food({ name: "   " }))).toBe(
      EMPTY_MEALS_CONFIG,
    );
  });

  it("is idempotent on id, so the 409 dance can re-run it", () => {
    const fresh = addFood(base(), food({ id: "oats", name: "oats" }));
    expect(addFood(fresh, food({ id: "oats", name: "oats" }))).toBe(fresh);
  });

  it("carries seq and targets through untouched", () => {
    const targets = { kcal: 2200, p: 140, c: 220, f: 70 };
    const cfg = addFood(
      base({ seq: 7, targets }),
      food({ id: "oats", name: "oats" }),
    );
    expect(cfg.seq).toBe(7);
    expect(cfg.targets).toEqual(targets);
  });
});

describe("updateFood", () => {
  it("patches in place, leaving the history pointing at it", () => {
    const cfg = updateFood(base(), "rice", {
      name: "rice (small bowl)",
      kcal: 150,
    });
    expect(cfg.foods[0]).toEqual({
      id: "rice",
      name: "rice (small bowl)",
      kcal: 150,
      p: 4,
      c: 44,
      f: 1,
    });
    expect(cfg.entries[0].foodId).toBe("rice");
  });

  it("ignores an unknown id and an all-space name", () => {
    const cfg = base();
    expect(updateFood(cfg, "nope", { kcal: 1 })).toBe(cfg);
    expect(updateFood(cfg, "rice", { name: "   " })).toBe(cfg);
  });

  it("leaves the usage counters alone — a macro fix is not a meal", () => {
    const cfg = base({
      foods: [food({ uses: 9, lastUsed: "2026-07-20" })],
    });
    const patched = updateFood(cfg, "rice", { kcal: 210, name: "rice (cup)" });
    expect(patched.foods[0].uses).toBe(9);
    expect(patched.foods[0].lastUsed).toBe("2026-07-20");
  });

  it("re-running the same patch changes nothing further", () => {
    const once = updateFood(base(), "rice", { p: 5 });
    expect(updateFood(once, "rice", { p: 5 })).toEqual(once);
  });
});

describe("removeFood", () => {
  it("removes a food nothing has been eaten of", () => {
    expect(removeFood(base(), "chicken").foods.map((f) => f.id)).toEqual([
      "rice",
    ]);
  });

  it("is a no-op while an entry references it — history keeps its totals", () => {
    const cfg = base();
    expect(removeFood(cfg, "rice")).toBe(cfg);
  });

  it("is a no-op identity on an unknown id, so the 409 dance can re-run it", () => {
    const cfg = base();
    expect(removeFood(cfg, "nope")).toBe(cfg);
  });
});

describe("addEntry / removeEntry", () => {
  it("prepends — the array stays newest-first by construction", () => {
    const cfg = addEntry(base(), entry({ id: "e2", date: "2026-07-22" }));
    expect(cfg.entries.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("prepends regardless of the date — nothing re-sorts", () => {
    const cfg = addEntry(base(), entry({ id: "e0", date: "2020-01-01" }));
    expect(cfg.entries.map((e) => e.id)).toEqual(["e0", "e1"]);
  });

  it("is idempotent on id, so the 409 dance can re-run it", () => {
    const fresh = addEntry(base(), entry({ id: "e2" }));
    expect(addEntry(fresh, entry({ id: "e2" }))).toBe(fresh);
  });

  it("evicts the OLDEST entry past the cap", () => {
    const entries = Array.from({ length: MAX_ENTRIES }, (_, i) =>
      entry({ id: `e${i}` }),
    );
    const cfg = addEntry(base({ entries }), entry({ id: "new" }));
    expect(cfg.entries.length).toBe(MAX_ENTRIES);
    expect(cfg.entries[0].id).toBe("new");
    expect(cfg.entries.some((e) => e.id === `e${MAX_ENTRIES - 1}`)).toBe(false);
  });

  it("removes by id and keeps the remaining order", () => {
    const cfg = addEntry(base(), entry({ id: "e2" }));
    expect(removeEntry(cfg, "e1").entries.map((e) => e.id)).toEqual(["e2"]);
  });

  it("removeEntry is a no-op identity on an unknown id", () => {
    const cfg = base();
    expect(removeEntry(cfg, "nope")).toBe(cfg);
  });

  it("carries seq through untouched (the writer bumps it, not the transform)", () => {
    expect(addEntry(base({ seq: 7 }), entry({ id: "e2" })).seq).toBe(7);
    expect(removeEntry(base({ seq: 7 }), "e1").seq).toBe(7);
  });
});

describe("setTargets", () => {
  it("sets them, and replaces them wholesale", () => {
    const cfg = setTargets(base(), { kcal: 2200, p: 140, c: 220, f: 70 });
    expect(cfg.targets).toEqual({ kcal: 2200, p: 140, c: 220, f: 70 });
    expect(
      setTargets(cfg, { kcal: 2000, p: 150, c: 200, f: 60 }).targets,
    ).toEqual({ kcal: 2000, p: 150, c: 200, f: 60 });
  });

  it("re-running the same set changes nothing further", () => {
    const targets = { kcal: 2200, p: 140, c: 220, f: 70 };
    const once = setTargets(base(), targets);
    expect(setTargets(once, targets)).toEqual(once);
  });

  it("clears them on all zeros — no target, not a target of nothing", () => {
    const zero = { kcal: 0, p: 0, c: 0, f: 0 };
    const set = setTargets(base(), { kcal: 2200, p: 140, c: 220, f: 70 });
    expect(setTargets(set, zero).targets).toBeUndefined();
    // A stray save on the pristine form is a no-op shape, not a wedged state.
    expect(setTargets(base(), zero).targets).toBeUndefined();
    // And seq still rides through the clear untouched.
    expect(setTargets(base({ seq: 7 }), zero).seq).toBe(7);
  });
});

describe("foodName / entriesFor", () => {
  it("names a food, or reports the honest miss", () => {
    expect(foodName(base(), "rice")).toBe("rice (bowl)");
    expect(foodName(base(), "nope")).toBe("?");
  });

  it("lists one day's entries in the log's own order", () => {
    const cfg = base({
      entries: [
        entry({ id: "e3", date: "2026-07-21" }),
        entry({ id: "e2", date: "2026-07-20" }),
        entry({ id: "e1", date: "2026-07-20" }),
      ],
    });
    expect(entriesFor(cfg, "2026-07-20").map((e) => e.id)).toEqual([
      "e2",
      "e1",
    ]);
    expect(entriesFor(cfg, "2026-07-19")).toEqual([]);
  });
});

describe("dayTotals", () => {
  it("sums each food's macros times its quantity", () => {
    const cfg = base({
      entries: [
        entry({ id: "e1", foodId: "rice", qty: 2 }),
        entry({ id: "e2", foodId: "chicken", qty: 1.5 }),
      ],
    });
    expect(dayTotals(cfg, "2026-07-20")).toEqual({
      kcal: 200 * 2 + 220 * 1.5,
      p: 4 * 2 + 26 * 1.5,
      c: 44 * 2,
      f: 1 * 2 + 13 * 1.5,
    });
  });

  it("is zeroes for a day with nothing logged", () => {
    expect(dayTotals(base(), "2026-07-19")).toEqual({
      kcal: 0,
      p: 0,
      c: 0,
      f: 0,
    });
  });

  it("contributes nothing for an entry whose food left the library", () => {
    const cfg = base({
      foods: [],
      entries: [entry({ foodId: "rice", qty: 3 })],
    });
    expect(dayTotals(cfg, "2026-07-20")).toEqual({
      kcal: 0,
      p: 0,
      c: 0,
      f: 0,
    });
  });
});

describe("trailingProtein", () => {
  const cfg = base({
    entries: [
      entry({ id: "e3", date: "2026-07-02", foodId: "chicken", qty: 2 }),
      entry({ id: "e2", date: "2026-06-30", foodId: "chicken", qty: 1 }),
      entry({ id: "e1", date: "2026-06-20", foodId: "rice", qty: 1 }),
    ],
  });

  it("windows oldest → newest, ending at the given day, zero-filling", () => {
    expect(trailingProtein(cfg, "2026-07-02", 4)).toEqual([0, 26, 0, 52]);
  });

  it("crosses a month boundary correctly", () => {
    expect(trailingProtein(cfg, "2026-07-01", 2)).toEqual([26, 0]);
  });

  it("defaults to a fortnight", () => {
    const series = trailingProtein(cfg, "2026-07-02");
    expect(series).toHaveLength(14);
    expect(series[13]).toBe(52);
    expect(series[0]).toBe(0);
  });
});

describe("prevDay / nextDay / dayHeading", () => {
  it("walks backwards across month and year boundaries", () => {
    expect(prevDay("2026-08-01")).toBe("2026-07-31");
    expect(prevDay("2026-01-01")).toBe("2025-12-31");
  });

  it("walks forwards across month and year boundaries", () => {
    expect(nextDay("2026-07-31")).toBe("2026-08-01");
    expect(nextDay("2025-12-31")).toBe("2026-01-01");
  });

  it("mirrors: nextDay undoes prevDay", () => {
    expect(nextDay(prevDay("2026-08-03"))).toBe("2026-08-03");
  });

  it("labels the day it names", () => {
    expect(dayHeading("2026-08-03")).toBe("mon 3 aug");
    expect(dayHeading("2026-01-01")).toBe("thu 1 jan");
    expect(dayHeading("2025-12-31")).toBe("wed 31 dec");
  });
});

describe("parseQtyInput", () => {
  it("parses plain positive numbers", () => {
    expect(parseQtyInput("1")).toBe(1);
    expect(parseQtyInput("0.5")).toBe(0.5);
    expect(parseQtyInput("1.")).toBe(1);
    expect(parseQtyInput("01")).toBe(1);
  });

  it("rejects an empty, zero or over-cap quantity — nothing to log", () => {
    expect(parseQtyInput("")).toBeNull();
    expect(parseQtyInput(".")).toBeNull();
    expect(parseQtyInput("0")).toBeNull();
    expect(parseQtyInput("101")).toBeNull();
  });

  it("rejects anything that isn't a plain number", () => {
    expect(parseQtyInput("-1")).toBeNull();
    expect(parseQtyInput("abc")).toBeNull();
    expect(parseQtyInput("1e3")).toBeNull();
    expect(parseQtyInput("1 5")).toBeNull();
    expect(parseQtyInput("1.5.5")).toBeNull();
  });
});

describe("parseMacroInput", () => {
  it("parses plain numbers, holding an empty field as 0", () => {
    expect(parseMacroInput("220")).toBe(220);
    expect(parseMacroInput("0")).toBe(0);
    expect(parseMacroInput("")).toBe(0);
    expect(parseMacroInput("007")).toBe(7);
  });

  it("accepts decimals, rounded to one place — labels carry .5s", () => {
    expect(parseMacroInput("2.5")).toBe(2.5);
    expect(parseMacroInput("24.55")).toBe(24.6);
    expect(parseMacroInput("5.925")).toBe(5.9);
    expect(parseMacroInput("1.")).toBe(1);
    expect(parseMacroInput(".5")).toBe(0.5);
  });

  it("rejects signs, junk and anything past the cap", () => {
    expect(parseMacroInput(".")).toBeNull();
    expect(parseMacroInput("-5")).toBeNull();
    expect(parseMacroInput("abc")).toBeNull();
    expect(parseMacroInput("1e3")).toBeNull();
    expect(parseMacroInput("2.5.5")).toBeNull();
    expect(parseMacroInput("10001")).toBeNull();
  });
});

describe("mealsPayloadBytes / fitsMealsCap", () => {
  it("measures the JSON as UTF-8 bytes", () => {
    expect(mealsPayloadBytes(EMPTY_MEALS_CONFIG)).toBe(
      JSON.stringify(EMPTY_MEALS_CONFIG).length,
    );
  });

  it("accepts a real log and refuses one past the cap", () => {
    expect(fitsMealsCap(base())).toBe(true);
    const huge = base({ foods: [food({ name: "x".repeat(MEALS_MAX_BYTES) })] });
    expect(fitsMealsCap(huge)).toBe(false);
  });
});

describe("foodUsage", () => {
  it("reads the counters when the food carries them", () => {
    const cfg = base({
      foods: [food({ uses: 41, lastUsed: "2026-08-01" })],
      entries: [entry({ date: "2026-07-20" })],
    });
    expect(foodUsage(cfg, cfg.foods[0])).toEqual({
      uses: 41,
      lastUsed: "2026-08-01",
    });
  });

  it("derives from the entries in view when they are absent", () => {
    const cfg = base({
      entries: [
        entry({ id: "e3", date: "2026-07-24" }),
        entry({ id: "e2", date: "2026-07-22", foodId: "chicken" }),
        entry({ id: "e1", date: "2026-07-20" }),
      ],
    });
    expect(foodUsage(cfg, cfg.foods[0])).toEqual({
      uses: 2,
      lastUsed: "2026-07-24",
    });
    expect(foodUsage(cfg, cfg.foods[1])).toEqual({
      uses: 1,
      lastUsed: "2026-07-22",
    });
  });

  it("is zero and null for a food nothing in view was eaten of", () => {
    expect(foodUsage(base({ entries: [] }), food())).toEqual({
      uses: 0,
      lastUsed: null,
    });
  });

  it("a counter of zero still wins over the window — un-logged, not unknown", () => {
    const cfg = base({ foods: [food({ uses: 0 })] });
    expect(foodUsage(cfg, cfg.foods[0])).toEqual({ uses: 0, lastUsed: null });
  });
});

describe("addEntry counters", () => {
  it("materialises on the first bump, backfilling from the window", () => {
    const cfg = base({
      entries: [
        entry({ id: "e2", date: "2026-07-21" }),
        entry({ id: "e1", date: "2026-07-20" }),
      ],
    });
    const next = addEntry(cfg, entry({ id: "e3", date: "2026-07-25" }));
    expect(next.foods[0].uses).toBe(3);
    expect(next.foods[0].lastUsed).toBe("2026-07-25");
  });

  it("counts on from the counter once it exists — past the entry window", () => {
    const cfg = base({
      foods: [food({ uses: 40, lastUsed: "2026-08-01" })],
      entries: [],
    });
    const next = addEntry(cfg, entry({ id: "e9", date: "2026-08-02" }));
    expect(next.foods[0]).toMatchObject({ uses: 41, lastUsed: "2026-08-02" });
  });

  it("re-running the same entry id counts nothing further (the 409 dance)", () => {
    const once = addEntry(base({ entries: [] }), entry({ id: "e1" }));
    expect(once.foods[0].uses).toBe(1);
    expect(addEntry(once, entry({ id: "e1" }))).toBe(once);
  });

  it("never lets a back-filled past day pull lastUsed backwards", () => {
    const cfg = base({
      foods: [food({ uses: 5, lastUsed: "2026-08-10" })],
      entries: [],
    });
    const next = addEntry(cfg, entry({ id: "old", date: "2026-08-01" }));
    expect(next.foods[0]).toMatchObject({ uses: 6, lastUsed: "2026-08-10" });
  });

  it("leaves the library alone for a food it doesn't know", () => {
    const cfg = base();
    const next = addEntry(cfg, entry({ id: "e2", foodId: "nope" }));
    expect(next.foods).toBe(cfg.foods);
    expect(next.entries[0].id).toBe("e2");
  });
});

describe("removeEntry counters", () => {
  it("steps the count back, leaving a date the removal didn't touch", () => {
    const cfg = base({
      foods: [food({ uses: 5, lastUsed: "2026-08-10" })],
      entries: [entry({ id: "e1", date: "2026-08-01" })],
    });
    expect(removeEntry(cfg, "e1").foods[0]).toMatchObject({
      uses: 4,
      lastUsed: "2026-08-10",
    });
  });

  it("recomputes the date from what remains when the last use goes", () => {
    const cfg = base({
      foods: [food({ uses: 3, lastUsed: "2026-08-10" })],
      entries: [
        entry({ id: "e2", date: "2026-08-10" }),
        entry({ id: "e1", date: "2026-08-04" }),
      ],
    });
    expect(removeEntry(cfg, "e2").foods[0]).toMatchObject({
      uses: 2,
      lastUsed: "2026-08-04",
    });
  });

  it("drops the date when the window has nothing left to offer", () => {
    const cfg = base({
      foods: [food({ uses: 3, lastUsed: "2026-08-10" })],
      entries: [entry({ id: "e2", date: "2026-08-10" })],
    });
    const food0 = removeEntry(cfg, "e2").foods[0];
    expect(food0.uses).toBe(2);
    expect("lastUsed" in food0).toBe(false);
  });

  it("drops the date at zero — never logged again", () => {
    const cfg = base({
      foods: [food({ uses: 1, lastUsed: "2026-08-10" })],
      entries: [entry({ id: "e2", date: "2026-08-10" })],
    });
    const food0 = removeEntry(cfg, "e2").foods[0];
    expect(food0.uses).toBe(0);
    expect("lastUsed" in food0).toBe(false);
  });

  it("leaves an uncounted food alone — its derivation already follows", () => {
    const cfg = base({
      entries: [
        entry({ id: "e2", date: "2026-07-22" }),
        entry({ id: "e1", date: "2026-07-20" }),
      ],
    });
    const next = removeEntry(cfg, "e2");
    expect(next.foods).toBe(cfg.foods);
    expect(foodUsage(next, next.foods[0])).toEqual({
      uses: 1,
      lastUsed: "2026-07-20",
    });
  });
});

/** A library exercising every ordering rule: three foods on the same day (two of
 *  them tied on count, so the name breaks it — case-insensitively), an older one,
 *  one older still, and one never logged. */
const library = (): MealsConfig => ({
  v: 1,
  foods: [
    food({ id: "rice", name: "rice (bowl)", uses: 22, lastUsed: "2026-08-09" }),
    food({
      id: "whey",
      name: "whey (scoop)",
      uses: 33,
      lastUsed: "2026-08-16",
    }),
    food({
      id: "tuna",
      name: "tuna (¼ can)",
      uses: 41,
      lastUsed: "2026-08-16",
    }),
    food({ id: "roll", name: "party sausage roll" }),
    food({
      id: "aioli",
      name: "Aioli (tbsp)",
      uses: 41,
      lastUsed: "2026-08-16",
    }),
    food({ id: "pho", name: "pho (bowl)", uses: 2, lastUsed: "2026-07-16" }),
  ],
  entries: [],
});

const TODAY = "2026-08-16";

describe("rankFoods", () => {
  it("orders by last eaten, then most eaten, then name", () => {
    expect(rankFoods(library()).map((f) => f.id)).toEqual([
      "aioli",
      "tuna",
      "whey",
      "rice",
      "pho",
      "roll",
    ]);
  });

  it("ranks a library from before the counters off the entries in view", () => {
    const cfg = base({
      entries: [
        entry({ id: "e2", date: "2026-08-02", foodId: "chicken" }),
        entry({ id: "e1", date: "2026-08-01" }),
      ],
    });
    expect(rankFoods(cfg).map((f) => f.id)).toEqual(["chicken", "rice"]);
  });

  it("leaves the stored library in its own order", () => {
    const cfg = library();
    const before = cfg.foods.map((f) => f.id);
    rankFoods(cfg);
    expect(cfg.foods.map((f) => f.id)).toEqual(before);
  });
});

describe("bucketFoods", () => {
  it("groups the library, keeping the ranked order inside a bucket", () => {
    expect(
      bucketFoods(library(), TODAY).map((b) => [
        b.key,
        b.label,
        b.foods.map((f) => f.id),
      ]),
    ).toEqual([
      ["week", "this week", ["aioli", "tuna", "whey"]],
      ["month", "this month", ["rice"]],
      ["earlier", "earlier", ["pho"]],
      ["never", "never logged", ["roll"]],
    ]);
  });

  it("always returns the four buckets, even empty ones", () => {
    expect(bucketFoods(EMPTY_MEALS_CONFIG, TODAY).map((b) => b.key)).toEqual([
      "week",
      "month",
      "earlier",
      "never",
    ]);
  });

  it("splits at the 7- and 31-day edges", () => {
    const at = (lastUsed: string) =>
      bucketFoods(
        { v: 1, foods: [food({ uses: 1, lastUsed })], entries: [] },
        TODAY,
      ).find((b) => b.foods.length > 0)!.key;
    expect(at("2026-08-10")).toBe("week"); // 6 days
    expect(at("2026-08-09")).toBe("month"); // 7
    expect(at("2026-07-17")).toBe("month"); // 30
    expect(at("2026-07-16")).toBe("earlier"); // 31
  });
});

describe("matchFoods / matchIndex", () => {
  it("filters on a case-insensitive substring, keeping the ranked order", () => {
    expect(matchFoods(library(), "BOWL", 8).foods.map((f) => f.id)).toEqual([
      "rice",
      "pho",
    ]);
  });

  it("takes an empty query as the whole ranked library", () => {
    expect(matchFoods(library(), "  ", 10).foods.map((f) => f.id)).toEqual(
      rankFoods(library()).map((f) => f.id),
    );
  });

  it("caps at the limit and reports what it cut", () => {
    const { foods, more } = matchFoods(library(), "", 2);
    expect(foods.map((f) => f.id)).toEqual(["aioli", "tuna"]);
    expect(more).toBe(4);
  });

  it("says nothing matched rather than falling back to everything", () => {
    expect(matchFoods(library(), "zzz", 8)).toEqual({ foods: [], more: 0 });
  });

  it("finds the run to paint, and nothing to paint on a miss", () => {
    expect(matchIndex("chicken parmi", "PAR")).toBe(8);
    expect(matchIndex("party pie", "par")).toBe(0);
    expect(matchIndex("party pie", "zz")).toBe(-1);
    expect(matchIndex("party pie", "")).toBe(-1);
  });
});

describe("daysSinceYmd / ageLabel", () => {
  it("counts whole days across month and year boundaries", () => {
    expect(daysSinceYmd(TODAY, TODAY)).toBe(0);
    expect(daysSinceYmd("2026-07-31", TODAY)).toBe(16);
    expect(daysSinceYmd("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysSinceYmd(TODAY, "2026-08-14")).toBe(-2);
  });

  it("crosses a clock change without losing a day", () => {
    // Sydney's clocks move in early October; the math is UTC, so it can't notice.
    expect(daysSinceYmd("2026-10-01", "2026-10-08")).toBe(7);
  });

  it("labels the age, and says nothing for a food never logged", () => {
    expect(ageLabel(null, TODAY)).toBe("");
    expect(ageLabel(TODAY, TODAY)).toBe("today");
    expect(ageLabel("2026-08-15", TODAY)).toBe("1d");
    expect(ageLabel("2026-07-16", TODAY)).toBe("31d");
  });
});
