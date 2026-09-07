import { describe, expect, it } from "vitest";
import {
  clearCircle,
  drawCircle,
  EMPTY_CIRCLE,
  meetBar,
  normalizeCircle,
  reconcileCircle,
  type CircleConfig,
} from "./circlemarks";

const bar = {
  said: "one new restaurant this week, from the 5%",
  on: "2026-09-10",
  due: "2026-09-16",
};
const kept = { ...bar, met: "2026-09-14" };

describe("normalizeCircle", () => {
  it("accepts an empty record, an open bar, and a pending list", () => {
    expect(normalizeCircle({ v: 1, met: [] })).toEqual(EMPTY_CIRCLE);
    const full = { v: 1, seq: 4, open: bar, met: [kept] };
    expect(normalizeCircle(full)).toEqual(full);
  });

  it("drops an unknown key at every level", () => {
    const out = normalizeCircle({
      v: 1,
      met: [{ ...kept, mutated: 1 }],
      open: { ...bar, mutated: 1 },
      smuggled: true,
    });
    expect(out).toEqual({ v: 1, open: bar, met: [kept] });
  });

  it("rejects a wrong frame, a bad seq and a malformed bar", () => {
    expect(normalizeCircle(null)).toBeNull();
    expect(normalizeCircle({ v: 2, met: [] })).toBeNull();
    expect(normalizeCircle({ v: 1 })).toBeNull(); // the list is the record
    expect(normalizeCircle({ v: 1, met: {} })).toBeNull();
    expect(normalizeCircle({ v: 1, seq: -1, met: [] })).toBeNull();
    expect(
      normalizeCircle({ v: 1, met: [], open: { ...bar, said: "" } }),
    ).toBeNull();
    expect(
      normalizeCircle({ v: 1, met: [], open: { ...bar, due: "16 Sep" } }),
    ).toBeNull();
    // Due before spoken is broken at the shape, not at the deadline.
    expect(
      normalizeCircle({ v: 1, met: [], open: { ...bar, due: "2026-09-09" } }),
    ).toBeNull();
    // A met bar without its day is not a met bar; met before spoken is a lie.
    expect(normalizeCircle({ v: 1, met: [bar] })).toBeNull();
    expect(
      normalizeCircle({ v: 1, met: [{ ...kept, met: "2026-09-01" }] }),
    ).toBeNull();
    // The pending list is a week's worth, never a backlog.
    expect(
      normalizeCircle({ v: 1, met: Array.from({ length: 51 }, () => kept) }),
    ).toBeNull();
  });
});

describe("drawCircle", () => {
  it("draws around one bar", () => {
    expect(drawCircle(EMPTY_CIRCLE, bar)).toEqual({
      v: 1,
      open: bar,
      met: [],
    });
  });

  it("refuses while a bar stands — one circle at a time", () => {
    // The flaw, literally: this is the amendment that stops the panel becoming
    // a vow counter, so it lives in the transform rather than in a disabled
    // button. Unchanged, not thrown: the caller's typed text survives.
    const drawn = drawCircle(EMPTY_CIRCLE, bar);
    const again = drawCircle(drawn, {
      said: "the boxing class",
      on: "2026-09-11",
      due: "2026-09-30",
    });
    expect(again).toBe(drawn);
  });

  it("refuses a malformed bar", () => {
    expect(drawCircle(EMPTY_CIRCLE, { ...bar, said: "" })).toBe(EMPTY_CIRCLE);
    expect(drawCircle(EMPTY_CIRCLE, { ...bar, due: "2026-09-09" })).toBe(
      EMPTY_CIRCLE,
    );
  });
});

describe("clearCircle", () => {
  it("rubs out a false start and leaves an undrawn circle alone", () => {
    const drawn = drawCircle(EMPTY_CIRCLE, bar);
    expect(clearCircle(drawn)).toEqual({ v: 1, met: [] });
    expect(clearCircle(EMPTY_CIRCLE)).toBe(EMPTY_CIRCLE);
  });
});

describe("meetBar", () => {
  it("moves the open bar into the pending list, dated", () => {
    const drawn = drawCircle(EMPTY_CIRCLE, bar);
    const out = meetBar(drawn, "2026-09-14");
    expect(out).toEqual({ v: 1, met: [kept] });
    expect(out).not.toHaveProperty("open");
  });

  it("leaves the record alone with nothing open or a day before it was spoken", () => {
    expect(meetBar(EMPTY_CIRCLE, "2026-09-14")).toBe(EMPTY_CIRCLE);
    const drawn = drawCircle(EMPTY_CIRCLE, bar);
    expect(meetBar(drawn, "2026-09-01")).toBe(drawn);
    expect(meetBar(drawn, "not-a-day")).toBe(drawn);
  });

  it("keeps a bar met past its deadline — late is kept, not clean", () => {
    // Nothing is subtracted here either: the check-in judges lateness, the
    // store only records what happened.
    const drawn = drawCircle(EMPTY_CIRCLE, bar);
    expect(meetBar(drawn, "2026-09-20").met[0].met).toBe("2026-09-20");
  });
});

describe("reconcileCircle", () => {
  const seal = (over: Partial<{ sealedAt: string; circle: unknown[] }> = {}) =>
    ({
      sealedAt: "2026-09-16T21:00:00+10:00",
      ...over,
    }) as {
      sealedAt: string;
      circle?: { said: string; on: string; due: string; met?: string }[];
    };

  it("retires a pending bar the seal now carries", () => {
    const cfg: CircleConfig = { v: 1, met: [kept] };
    expect(reconcileCircle(cfg, seal({ circle: [kept] }))).toEqual({
      v: 1,
      met: [],
    });
  });

  it("keeps a pending bar the seal carries only as an OPEN row", () => {
    // A seal can carry the bar without its met day — that is the same bar
    // still standing, not the one that was folded in.
    const cfg: CircleConfig = { v: 1, met: [kept] };
    expect(reconcileCircle(cfg, seal({ circle: [bar] }))).toBe(cfg);
  });

  it("retires an open bar the newest seal judged", () => {
    const cfg: CircleConfig = { v: 1, open: bar, met: [] };
    // Due 09-16, sealed 09-16 — still standing on the day itself.
    expect(reconcileCircle(cfg, seal())).toBe(cfg);
    const after = reconcileCircle(
      cfg,
      seal({ sealedAt: "2026-09-23T21:00:00+10:00" }),
    );
    expect(after).toEqual({ v: 1, met: [] });
    expect(after).not.toHaveProperty("open");
  });

  it("returns the SAME object when nothing changed", () => {
    const cfg: CircleConfig = { v: 1, seq: 3, open: bar, met: [kept] };
    expect(reconcileCircle(cfg, seal())).toBe(cfg);
    expect(reconcileCircle(EMPTY_CIRCLE, seal())).toBe(EMPTY_CIRCLE);
  });

  it("retires both at once and keeps the counter", () => {
    const cfg: CircleConfig = { v: 1, seq: 7, open: bar, met: [kept] };
    const out = reconcileCircle(
      cfg,
      seal({ sealedAt: "2026-09-23T21:00:00+10:00", circle: [kept] }),
    );
    expect(out).toEqual({ v: 1, seq: 7, met: [] });
  });
});
