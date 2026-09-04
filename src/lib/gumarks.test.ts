import { describe, expect, it } from "vitest";
import type { ApertureRefinement } from "./aperture";
import {
  EMPTY_GU_MARKS,
  normalizeGuMarks,
  reconcileMarks,
  unsealedCasts,
  withCast,
  withSince,
} from "./gumarks";

const pizza: ApertureRefinement = {
  name: "a pizza, from dough",
  rank: "1",
  type: "consumable · made, food path",
  test: "the base holds",
};
const effort: ApertureRefinement = {
  name: "all-out effort",
  rank: "1 → 6",
  type: "human · strength, continuous",
  test: "a full cycle",
  since: "2026-07-14",
};

describe("gumarks — normalizeGuMarks", () => {
  it("accepts an empty record and a full one", () => {
    expect(normalizeGuMarks(EMPTY_GU_MARKS)).toEqual(EMPTY_GU_MARKS);
    const full = {
      v: 1,
      seq: 3,
      marks: {
        [pizza.name]: { since: "2026-09-05" },
        ticket: { cast: { date: "2026-09-05", stones: 1800 } },
        both: { since: "2026-09-01", cast: { date: "2026-09-05" } },
      },
    };
    expect(normalizeGuMarks(full)).toEqual(full);
  });

  it("rejects the wrong frame, a bad seq, and a bad mark", () => {
    expect(normalizeGuMarks({ v: 2, marks: {} })).toBeNull();
    expect(normalizeGuMarks({ v: 1, seq: -1, marks: {} })).toBeNull();
    expect(normalizeGuMarks({ v: 1, marks: [] })).toBeNull();
    expect(normalizeGuMarks({ v: 1, marks: { a: {} } })).toBeNull(); // says nothing
    expect(
      normalizeGuMarks({ v: 1, marks: { a: { since: "5 sep" } } }),
    ).toBeNull();
    expect(
      normalizeGuMarks({
        v: 1,
        marks: { a: { cast: { date: "2026-09-05", stones: 1.5 } } },
      }),
    ).toBeNull();
    expect(
      normalizeGuMarks({ v: 1, marks: { "": { since: "2026-09-05" } } }),
    ).toBeNull();
  });

  it("drops unknown keys inside a mark", () => {
    expect(
      normalizeGuMarks({ v: 1, marks: { a: { since: "2026-09-05", x: 1 } } }),
    ).toEqual({ v: 1, marks: { a: { since: "2026-09-05" } } });
  });
});

describe("gumarks — the transforms", () => {
  it("begins and clears a refinement", () => {
    const begun = withSince(EMPTY_GU_MARKS, pizza.name, "2026-09-05");
    expect(begun.marks).toEqual({ [pizza.name]: { since: "2026-09-05" } });
    expect(withSince(begun, pizza.name, null)).toEqual(EMPTY_GU_MARKS);
    expect(EMPTY_GU_MARKS.marks).toEqual({}); // never mutates its input
  });

  it("casts, keeps the since beside it, and clears the cast alone", () => {
    const begun = withSince(EMPTY_GU_MARKS, pizza.name, "2026-09-05");
    const cast = withCast(begun, pizza.name, {
      date: "2026-09-05",
      stones: 1800,
    });
    expect(cast.marks[pizza.name]).toEqual({
      since: "2026-09-05",
      cast: { date: "2026-09-05", stones: 1800 },
    });
    expect(withCast(cast, pizza.name, null)).toEqual(begun);
  });
});

describe("gumarks — reconcileMarks", () => {
  it("retires a mark whose entry left the book, and a since the seal now dates", () => {
    const cfg = {
      v: 1 as const,
      marks: {
        gone: { cast: { date: "2026-09-05" } },
        [effort.name]: { since: "2026-07-14" },
        [pizza.name]: { since: "2026-09-05" },
      },
    };
    expect(reconcileMarks(cfg, [effort, pizza])).toEqual({
      v: 1,
      marks: { [pizza.name]: { since: "2026-09-05" } },
    });
  });

  it("keeps a cast beside a since the seal caught up with", () => {
    const cfg = {
      v: 1 as const,
      marks: {
        [effort.name]: { since: "2026-07-14", cast: { date: "2026-09-05" } },
      },
    };
    expect(reconcileMarks(cfg, [effort]).marks).toEqual({
      [effort.name]: { cast: { date: "2026-09-05" } },
    });
  });

  it("returns the same object when nothing changed", () => {
    const cfg = withSince(EMPTY_GU_MARKS, pizza.name, "2026-09-05");
    expect(reconcileMarks(cfg, [pizza])).toBe(cfg);
  });
});

describe("gumarks — unsealedCasts", () => {
  it("turns cast marks into cast rows carrying the entry's type", () => {
    const cfg = withCast(EMPTY_GU_MARKS, pizza.name, {
      date: "2026-09-05",
      stones: 1800,
    });
    expect(unsealedCasts(cfg, [effort, pizza])).toEqual([
      { date: "2026-09-05", name: pizza.name, stones: 1800, type: pizza.type },
    ]);
    expect(
      unsealedCasts(withSince(EMPTY_GU_MARKS, pizza.name, "2026-09-05"), [
        pizza,
      ]),
    ).toEqual([]);
  });
});
