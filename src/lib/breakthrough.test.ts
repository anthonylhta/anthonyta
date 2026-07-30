import { describe, expect, it } from "vitest";
import { IMMORTAL_ESSENCE, MORTAL_ESSENCE } from "./aperture";
import { ESSENCE_VAR } from "./apertureview";
import { breakthroughReading, essenceVarRef, readSeen } from "./breakthrough";

/** The canon, flattened — 20 mortal shades plus 4 immortal names. */
const CANON_NAMES = [
  ...Object.values(MORTAL_ESSENCE).flatMap((stages) => Object.values(stages)),
  ...Object.values(IMMORTAL_ESSENCE),
];

describe("essenceVarRef", () => {
  it("derives the same token the sheet declares, over the whole canon", () => {
    expect(CANON_NAMES).toHaveLength(24);
    for (const name of CANON_NAMES) {
      const declared = ESSENCE_VAR[name];
      expect(declared, name).toBeDefined();
      // ESSENCE_VAR is `[--essence:var(--color-x)]`; the sweep needs the middle.
      expect(essenceVarRef(name), name).toBe(
        declared.slice("[--essence:".length, -1),
      );
    }
  });

  it("null for anything off the canon — including a near miss", () => {
    expect(essenceVarRef("jade green")).toBeNull();
    expect(essenceVarRef("Mauve")).toBeNull();
    expect(essenceVarRef("")).toBeNull();
    // The set must not answer for Object.prototype's members either.
    expect(essenceVarRef("toString")).toBeNull();
  });
});

describe("readSeen", () => {
  it("reads a well-formed memory", () => {
    expect(readSeen('{"rank":2,"stage":"upper"}')).toEqual({
      rank: 2,
      stage: "upper",
    });
  });

  it("rebuilds the pair, so nothing extra rides in", () => {
    expect(
      readSeen('{"rank":1,"stage":"initial","essence":"Snow Silver"}'),
    ).toEqual({ rank: 1, stage: "initial" });
  });

  it("null for no memory, junk, and the wrong shape", () => {
    expect(readSeen(null)).toBeNull();
    expect(readSeen("")).toBeNull();
    expect(readSeen("{rank:1}")).toBeNull();
    expect(readSeen("null")).toBeNull();
    expect(readSeen('"rank 1"')).toBeNull();
    expect(readSeen("[1,2]")).toBeNull();
  });

  it("null on a partial or malformed pair", () => {
    expect(readSeen('{"rank":1}')).toBeNull();
    expect(readSeen('{"stage":"initial"}')).toBeNull();
    expect(readSeen('{"rank":"1","stage":"initial"}')).toBeNull();
    expect(readSeen('{"rank":1.5,"stage":"initial"}')).toBeNull();
    expect(readSeen('{"rank":0,"stage":"initial"}')).toBeNull();
    expect(readSeen('{"rank":1,"stage":""}')).toBeNull();
  });
});

describe("breakthroughReading", () => {
  it("shade to shade inside one metal", () => {
    expect(breakthroughReading(1, "initial", 1, "middle")).toEqual({
      from: "jade green",
      to: "pale green",
    });
  });

  it("metal to metal across the wall", () => {
    expect(breakthroughReading(1, "peak", 2, "initial")).toEqual({
      from: "Green Copper",
      to: "Red Steel",
    });
  });

  it("the essence name on whichever side is immortal", () => {
    expect(breakthroughReading(5, "peak", 6, "initial")).toEqual({
      from: "Purple Crystal",
      to: "Green Grape",
    });
    expect(breakthroughReading(6, "initial", 7, "initial")).toEqual({
      from: "Green Grape",
      to: "Red Date",
    });
  });

  it("null off the canon at either end", () => {
    expect(breakthroughReading(1, "initial", 10, "initial")).toBeNull();
    expect(breakthroughReading(0, "initial", 1, "initial")).toBeNull();
    expect(breakthroughReading(1, "ascended", 1, "middle")).toBeNull();
    expect(breakthroughReading(1, "initial", 1, "ascended")).toBeNull();
  });

  it("null when nothing moved — including a stage under a stageless rank", () => {
    expect(breakthroughReading(3, "upper", 3, "upper")).toBeNull();
    expect(breakthroughReading(6, "initial", 6, "peak")).toBeNull();
  });
});
