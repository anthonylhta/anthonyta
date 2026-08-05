import { describe, expect, it } from "vitest";
import { QUOTES, quoteForDay } from "./quotes";

/** The tier a rank actually draws from — its own lines plus all scripture. */
const tier = (rank: number) =>
  QUOTES.filter((q) => q.rank === rank || q.rank === null);

describe("quotes — the bank", () => {
  it("carries a non-empty line, correctly ranked, in every entry", () => {
    for (const q of QUOTES) {
      expect(q.text.trim().length, JSON.stringify(q)).toBeGreaterThan(0);
      if (q.rank !== null) {
        expect(Number.isInteger(q.rank)).toBe(true);
        expect(q.rank).toBeGreaterThanOrEqual(1);
        expect(q.rank).toBeLessThanOrEqual(9);
      }
    }
  });

  it("stocks rank 1 — the rank the sheet actually stands at", () => {
    // The tier the page reads today must never be empty: an empty tier is the one
    // case `quoteForDay` answers with null, and a home page with no line is a bug
    // nobody would notice until the day it happened.
    expect(tier(1).length).toBeGreaterThan(0);
  });

  it("holds scripture that belongs to no rank", () => {
    expect(QUOTES.some((q) => q.rank === null)).toBe(true);
  });
});

describe("quotes — quoteForDay", () => {
  it("is deterministic for a day", () => {
    expect(quoteForDay(1, "2026-08-06")).toBe(quoteForDay(1, "2026-08-06"));
  });

  it("cycles: consecutive days differ while the tier has room", () => {
    expect(tier(1).length).toBeGreaterThan(1);
    expect(quoteForDay(1, "2026-08-06")).not.toBe(quoteForDay(1, "2026-08-07"));
  });

  it("comes back around after a full turn of the tier", () => {
    const size = tier(1).length;
    const start = Date.UTC(2026, 7, 6) / 86_400_000;
    const day = (n: number) =>
      new Date((start + n) * 86_400_000).toISOString().slice(0, 10);
    expect(quoteForDay(1, day(size))).toBe(quoteForDay(1, day(0)));
  });

  it("keeps a rank's own lines to that rank", () => {
    // A rank-3 line must not surface at rank 1: the tiering is what stops the page
    // quoting a road that hasn't been walked yet.
    const higher = QUOTES.filter((q) => q.rank !== null && q.rank > 1);
    expect(higher.length).toBeGreaterThan(0);
    const size = tier(1).length;
    const start = Date.UTC(2026, 0, 1) / 86_400_000;
    for (let n = 0; n < size; n++) {
      const iso = new Date((start + n) * 86_400_000).toISOString().slice(0, 10);
      const picked = quoteForDay(1, iso);
      expect(picked).not.toBeNull();
      expect(picked?.rank === 1 || picked?.rank === null).toBe(true);
    }
  });

  it("admits scripture at every rank", () => {
    // Every rank's tier contains all of it — the "bible of their world" ruling,
    // pinned so a later tiering pass can't quietly demote it to a rank-1 fallback.
    const scripture = QUOTES.filter((q) => q.rank === null);
    for (const rank of [1, 2, 3, 9])
      for (const q of scripture) expect(tier(rank)).toContain(q);
  });

  it("still answers when the day is unreadable", () => {
    // Deterministic is the promise, not "only for well-formed days": a broken day
    // gets the tier's first line, never a blank line on the home page.
    expect(quoteForDay(1, "whenever")).toBe(tier(1)[0]);
    expect(quoteForDay(1, "2026-8-6")).toBe(tier(1)[0]);
  });

  it("answers null only when a tier is empty", () => {
    // No rank-9 lines are stocked (the ten-in-three-million-years tier), and
    // scripture is stocked for every rank — so an empty tier can only happen if
    // the scripture itself were emptied. The wiki-excerpt curation pass stocked
    // every mortal tier and 6–8, so rank 9 is the one honest probe left.
    expect(QUOTES.some((q) => q.rank === 9)).toBe(false);
    expect(quoteForDay(9, "2026-08-06")).not.toBeNull();
  });
});
