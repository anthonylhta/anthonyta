import { describe, expect, it } from "vitest";
import { isBriefing, MAX_LIST, MAX_TAPE, MAX_TEXT } from "./briefing";
import { sampleBriefing } from "./sampleBriefing";

/** A minimal but complete valid briefing (all required fields, no optionals). */
const base = () => ({
  date: "2026-07-13",
  weekday: "Mon",
  generated: "06:30 AEST",
  driver: "test driver",
  summary: "a one-line summary of the day",
  tape: [{ label: "S&P 500", value: "ATH", move: 1.1 }],
  bottomLine: ["a bottom-line point"],
  watch: [{ date: "23 Jun", label: "global flash PMIs" }],
  sections: [{ title: "equities", points: ["a point"] }],
});

describe("isBriefing", () => {
  it("accepts the real sample briefing", () => {
    expect(isBriefing(sampleBriefing)).toBe(true);
  });

  it("accepts a minimal valid briefing (optionals absent)", () => {
    expect(isBriefing(base())).toBe(true);
    // tape.move is optional
    expect(
      isBriefing({ ...base(), tape: [{ label: "US 10Y", value: "4.46%" }] }),
    ).toBe(true);
  });

  it("accepts the optionals when present and well-formed", () => {
    expect(
      isBriefing({
        ...base(),
        portfolio: "the owner-only relevance note",
        sources: [{ label: "Trading Economics", url: "https://example.com" }],
      }),
    ).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isBriefing(null)).toBe(false);
    expect(isBriefing("briefing")).toBe(false);
    expect(isBriefing(42)).toBe(false);
    expect(isBriefing(undefined)).toBe(false);
  });

  it("rejects each required field missing", () => {
    for (const key of [
      "date",
      "weekday",
      "generated",
      "driver",
      "summary",
      "tape",
      "bottomLine",
      "watch",
      "sections",
    ]) {
      const b: Record<string, unknown> = base();
      delete b[key];
      expect(isBriefing(b), `missing ${key}`).toBe(false);
    }
  });

  it("rejects each required field wrong-typed", () => {
    expect(isBriefing({ ...base(), date: 5 })).toBe(false);
    expect(isBriefing({ ...base(), summary: 5 })).toBe(false);
    expect(isBriefing({ ...base(), tape: "nope" })).toBe(false);
    expect(isBriefing({ ...base(), bottomLine: [5] })).toBe(false);
    // a tape item with a non-numeric move
    expect(
      isBriefing({ ...base(), tape: [{ label: "x", value: "y", move: "up" }] }),
    ).toBe(false);
    // a watch item missing its label
    expect(isBriefing({ ...base(), watch: [{ date: "23 Jun" }] })).toBe(false);
    // a section with a non-string point
    expect(
      isBriefing({ ...base(), sections: [{ title: "x", points: [5] }] }),
    ).toBe(false);
  });

  it("rejects a bad optional when present", () => {
    expect(isBriefing({ ...base(), portfolio: 5 })).toBe(false);
    expect(isBriefing({ ...base(), sources: "nope" })).toBe(false);
    // a source missing its url
    expect(isBriefing({ ...base(), sources: [{ label: "x" }] })).toBe(false);
  });

  it("rejects oversize arrays", () => {
    const tapeItem = { label: "x", value: "y" };
    expect(
      isBriefing({ ...base(), tape: Array(MAX_TAPE + 1).fill(tapeItem) }),
    ).toBe(false);
    expect(
      isBriefing({ ...base(), bottomLine: Array(MAX_LIST + 1).fill("x") }),
    ).toBe(false);
    expect(
      isBriefing({
        ...base(),
        sections: Array(MAX_LIST + 1).fill({ title: "t", points: [] }),
      }),
    ).toBe(false);
    // …at the cap it is still accepted
    expect(
      isBriefing({ ...base(), tape: Array(MAX_TAPE).fill(tapeItem) }),
    ).toBe(true);
  });

  it("rejects oversize strings and oversize section-point lists", () => {
    expect(isBriefing({ ...base(), summary: "x".repeat(MAX_TEXT + 1) })).toBe(
      false,
    );
    expect(
      isBriefing({
        ...base(),
        sections: [{ title: "t", points: Array(MAX_LIST + 1).fill("p") }],
      }),
    ).toBe(false);
  });
});
