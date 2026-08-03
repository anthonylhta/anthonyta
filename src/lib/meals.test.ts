import { describe, expect, it } from "vitest";
import {
  EMPTY_MEALS_CONFIG,
  MAX_ENTRIES,
  MEALS_MAX_BYTES,
  addEntry,
  addFood,
  dayHeading,
  dayTotals,
  entriesFor,
  nextDay,
  prevDay,
  fitsMealsCap,
  foodName,
  mealsPayloadBytes,
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
  it("parses whole numbers, holding an empty field as 0", () => {
    expect(parseMacroInput("220")).toBe(220);
    expect(parseMacroInput("0")).toBe(0);
    expect(parseMacroInput("")).toBe(0);
    expect(parseMacroInput("007")).toBe(7);
  });

  it("rejects decimals, signs and anything past the cap", () => {
    expect(parseMacroInput("2.5")).toBeNull();
    expect(parseMacroInput("-5")).toBeNull();
    expect(parseMacroInput("abc")).toBeNull();
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
