import { describe, expect, it } from "vitest";
import { QUOTES, quoteForDay } from "./quotes";

/** The tier a rank actually draws from — its own lines plus all scripture. */
const tier = (rank: number) =>
  QUOTES.filter((q) => q.rank === rank || q.rank === null);

/** Fang Yuan's rank by chapter in the second life, off the wiki's Cultivation
 *  table — the same windows the bank's header documents. A chapter outside every
 *  window belongs to no rank. */
const RANK_WINDOWS: readonly [rank: number, from: number, to: number][] = [
  [1, 1, 91], // the rebirth and the awakening (ch. 5) are the same mortal era
  [2, 92, 151],
  [3, 152, 197],
  [1, 198, 232], // the Blood Skull reset
  [2, 233, 272],
  [3, 273, 330],
  [4, 331, 474],
  [5, 475, 632],
  [6, 633, 1205],
  [7, 1206, 1766],
  [8, 1767, 2205],
  [9, 2206, Infinity],
];
const rankAtChapter = (ch: number) =>
  RANK_WINDOWS.find(([, from, to]) => ch >= from && ch <= to)?.[0] ?? null;

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

  it("tiers every Fang Yuan line by the chapter his own rank stood at", () => {
    // The doctrine's promise: the page never quotes a road that hasn't been
    // walked. The chapter is in every `arc`, the rank-by-chapter table is above,
    // so a mis-tiered line is a red test, not a reader's suspicion. The ch. 1285
    // first-life flashbacks are the one ruled exception (tier 1 — the mortal
    // era remembered).
    const ranked = QUOTES.filter((q) => q.rank !== null);
    expect(ranked.length).toBeGreaterThan(0);
    for (const q of ranked) {
      const arc = q.arc ?? "";
      if (arc.includes("first life")) {
        expect(q.rank, arc).toBe(1);
        continue;
      }
      const m = /^ch\. (\d+)/.exec(arc);
      expect(m, `no chapter in arc: ${arc}`).not.toBeNull();
      expect(rankAtChapter(Number(m![1])), `${arc} → rank ${q.rank}`).toBe(
        q.rank,
      );
    }
  });

  it("carries the original sentence on every translated (十八层) line", () => {
    // The mind novel's lines are translated here, not excerpted from a fan
    // translation — so the provenance a reader can check is the original itself.
    const translated = QUOTES.filter((q) => q.arc?.startsWith("十八层"));
    expect(translated.length).toBeGreaterThan(0);
    for (const q of translated) {
      expect(q.rank, q.arc).toBeNull();
      expect(q.zh?.trim().length, q.arc).toBeGreaterThan(0);
    }
    // and the excerpted lines never pretend to be translations
    for (const q of QUOTES.filter((q) => !q.arc?.startsWith("十八层")))
      expect(q.zh, q.arc).toBeUndefined();
  });

  it("keeps the mind novel's third realm out until a seal opens it", () => {
    // 超我 reads mortal on the sheet: nothing from the superego's road — 失我劫,
    // 鬼仙, the third realm's booklet — is stocked yet. The curation rule, pinned.
    for (const q of QUOTES.filter((q) => q.arc?.startsWith("十八层"))) {
      expect(q.zh, q.arc).not.toMatch(/超我失我|失我劫|鬼仙|三境/);
      expect(q.arc, q.arc).not.toMatch(/superego booklet|third realm/);
    }
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

  it("answers at every rank, one through nine", () => {
    // Every mortal and immortal tier is stocked (rank 9 since the venerable
    // poem was re-tiered to the chapter it was recited at), and scripture rides
    // with all of them — so null, the empty-tier answer, is unreachable while
    // the scripture stands. Pinned across the whole ladder.
    for (let rank = 1; rank <= 9; rank++) {
      expect(
        QUOTES.some((q) => q.rank === rank),
        `rank ${rank}`,
      ).toBe(true);
      expect(quoteForDay(rank, "2026-08-06")).not.toBeNull();
    }
  });
});
