import { describe, expect, it } from "vitest";
import { isNoteTag, NOTE_TAGS, notes, tagCounts } from "./notes";

// Structural pins over the notes DATA — deliberately content-free so they stay
// green as notes are appended weekly, and red the moment an entry is malformed.

describe("notes data", () => {
  it("slugs are unique and url-shaped", () => {
    const seen = new Set<string>();
    for (const n of notes) {
      expect(n.slug).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(n.slug), `duplicate slug ${n.slug}`).toBe(false);
      seen.add(n.slug);
    }
  });

  it("every note carries exactly one known tag", () => {
    for (const n of notes)
      expect(isNoteTag(n.tag), `${n.slug} has unknown tag ${n.tag}`).toBe(true);
  });

  it("updated stamps are ISO dates", () => {
    for (const n of notes) expect(n.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("related slugs resolve", () => {
    const all = new Set(notes.map((n) => n.slug));
    for (const n of notes)
      for (const r of n.related ?? [])
        expect(all.has(r), `${n.slug} relates to missing ${r}`).toBe(true);
  });

  it("tagCounts sums to the corpus and covers the vocabulary", () => {
    const counts = tagCounts(notes);
    expect(Object.keys(counts).sort()).toEqual([...NOTE_TAGS].sort());
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(notes.length);
  });

  it("isNoteTag narrows strictly", () => {
    expect(isNoteTag("e2ee")).toBe(true);
    expect(isNoteTag("E2EE")).toBe(false);
    expect(isNoteTag("")).toBe(false);
    expect(isNoteTag(undefined)).toBe(false);
    expect(isNoteTag(["e2ee"])).toBe(false);
  });
});
