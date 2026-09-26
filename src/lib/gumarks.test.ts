import { describe, expect, it } from "vitest";
import type { ApertureRefinement } from "./aperture";
import {
  EMPTY_GU_MARKS,
  MAX_FREE_CASTS,
  clearCast,
  normalizeGuMarks,
  reconcileMarks,
  unsealedCasts,
  withCast,
  withFreeCast,
  withSince,
  type GuFreeCast,
} from "./gumarks";

const pizza: ApertureRefinement = {
  name: "a pizza, from dough",
  rank: "1",
  type: "consumable · made, food path",
  test: "the base holds",
};
const cinema: GuFreeCast = {
  date: "2026-09-20",
  name: "the cinema — Resident Evil",
  stones: 0,
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

describe("gumarks — free casts", () => {
  it("accepts a record carrying free casts, and one without", () => {
    const full = {
      v: 1,
      marks: {},
      casts: [cinema, { date: "2026-09-21", name: "karaoke" }],
    };
    expect(normalizeGuMarks(full)).toEqual(full);
    // An empty list is the same record as none at all.
    expect(normalizeGuMarks({ v: 1, marks: {}, casts: [] })).toEqual(
      EMPTY_GU_MARKS,
    );
  });

  it("rejects the record over one bad free cast", () => {
    const bad = (c: unknown) =>
      normalizeGuMarks({ v: 1, marks: {}, casts: [cinema, c] });
    expect(bad({ date: "20 sep", name: "karaoke" })).toBeNull();
    expect(bad({ date: "2026-09-20", name: "   " })).toBeNull();
    expect(bad({ date: "2026-09-20", name: "x".repeat(201) })).toBeNull();
    expect(bad({ date: "2026-09-20", name: "k", stones: 1.5 })).toBeNull();
    expect(bad({ date: "2026-09-20", name: "k", stones: -1 })).toBeNull();
    expect(normalizeGuMarks({ v: 1, marks: {}, casts: {} })).toBeNull();
    expect(
      normalizeGuMarks({
        v: 1,
        marks: {},
        casts: Array(MAX_FREE_CASTS + 1).fill(cinema),
      }),
    ).toBeNull();
  });

  it("trims a name and drops unknown keys", () => {
    expect(
      normalizeGuMarks({
        v: 1,
        marks: {},
        casts: [{ date: "2026-09-21", name: "  karaoke ", x: 1 }],
      }),
    ).toEqual({
      v: 1,
      marks: {},
      casts: [{ date: "2026-09-21", name: "karaoke" }],
    });
  });

  it("appends newest last, and refuses past the cap", () => {
    const one = withFreeCast(EMPTY_GU_MARKS, cinema);
    const two = withFreeCast(one, { date: "2026-09-21", name: "karaoke" });
    expect(two.casts?.map((c) => c.name)).toEqual([cinema.name, "karaoke"]);
    expect(EMPTY_GU_MARKS.casts).toBeUndefined(); // never mutates its input
    const full = {
      v: 1 as const,
      marks: {},
      casts: Array(MAX_FREE_CASTS).fill(cinema),
    };
    expect(withFreeCast(full, cinema)).toBe(full);
  });

  it("clears a free cast by name and day, and a book cast by name", () => {
    const cfg = withFreeCast(
      withFreeCast(
        withCast(EMPTY_GU_MARKS, pizza.name, { date: "2026-09-05" }),
        cinema,
      ),
      { ...cinema, date: "2026-09-27" },
    );
    const noCinema = clearCast(cfg, cinema.name, "2026-09-20");
    expect(noCinema.casts).toEqual([{ ...cinema, date: "2026-09-27" }]);
    expect(noCinema.marks[pizza.name]).toBeDefined();
    const noPizza = clearCast(cfg, pizza.name, "2026-09-05");
    expect(noPizza.marks).toEqual({});
    expect(noPizza.casts).toEqual(cfg.casts);
    // The last free cast gone leaves no empty list behind.
    expect(
      clearCast(withFreeCast(EMPTY_GU_MARKS, cinema), cinema.name, cinema.date),
    ).toEqual(EMPTY_GU_MARKS);
  });

  it("retires a free cast once the seal carries the same day and name", () => {
    const cfg = withFreeCast(withFreeCast(EMPTY_GU_MARKS, cinema), {
      date: "2026-09-21",
      name: "karaoke",
      stones: 2550,
    });
    const settled = reconcileMarks(
      cfg,
      [],
      [{ date: cinema.date, name: cinema.name, stones: 0, type: "experience" }],
    );
    expect(settled.casts).toEqual([
      { date: "2026-09-21", name: "karaoke", stones: 2550 },
    ]);
    // Same name on another day is another cast.
    expect(
      reconcileMarks(cfg, [], [{ date: "2026-09-19", name: cinema.name }]),
    ).toBe(cfg);
    expect(
      reconcileMarks(withFreeCast(EMPTY_GU_MARKS, cinema), [], [cinema]),
    ).toEqual(EMPTY_GU_MARKS);
  });

  it("keeps free casts while retiring book marks", () => {
    const cfg = withFreeCast(
      withCast(EMPTY_GU_MARKS, "gone", { date: "2026-09-05" }),
      cinema,
    );
    expect(reconcileMarks(cfg, [pizza])).toEqual({
      v: 1,
      marks: {},
      casts: [cinema],
    });
  });

  it("reads free casts as untyped cast rows after the book's", () => {
    const cfg = withFreeCast(
      withCast(EMPTY_GU_MARKS, pizza.name, { date: "2026-09-05" }),
      cinema,
    );
    expect(unsealedCasts(cfg, [pizza])).toEqual([
      { date: "2026-09-05", name: pizza.name, type: pizza.type },
      cinema,
    ]);
  });
});
