import { describe, expect, it } from "vitest";
import {
  compareIndexNotes,
  deriveId,
  imageBlob,
  isValidVaultPath,
  isVaultIndex,
  noteBlob,
  notePreview,
  parseVaultImgId,
  VAULT_INDEX_PATH,
  VAULT_SEARCH_INDEX_PATH,
  type VaultIndex,
  type VaultIndexNote,
} from "./vaultblob";

// A well-formed 22-char base64url id (letters, digits, `-`, `_`).
const ID = "Ab-dEfGhIjKlMnOpQrSt_v";

describe("deriveId", () => {
  it("is deterministic — same path, same id", async () => {
    expect(await deriveId("Journals/2026-07-11.md")).toBe(
      await deriveId("Journals/2026-07-11.md"),
    );
  });
  it("is always 22 base64url chars", async () => {
    for (const p of ["a", "Journals/2026-07-11.md", "x".repeat(500)]) {
      const id = await deriveId(p);
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });
  it("matches a fixed known vector", async () => {
    expect(await deriveId("Journals/2026-07-11.md")).toBe(
      "JAiERnIDFnQPEKIle49kwg",
    );
  });
  it("NFC-normalizes, so composed and decomposed é name the same blob", async () => {
    const composed = "café.md"; // é as one code point
    const decomposed = "café.md"; // e + combining acute
    expect(composed).not.toBe(decomposed); // genuinely different bytes
    expect(await deriveId(composed)).toBe(await deriveId(decomposed));
    expect(await deriveId(composed)).toBe("dmELpTJOusefrrNqJoPtEw");
  });
  it("gives different paths different ids", async () => {
    expect(await deriveId("Journals/a.md")).not.toBe(
      await deriveId("Journals/b.md"),
    );
  });
});

describe("noteBlob / imageBlob", () => {
  it("format an id into its stored blob name", () => {
    expect(noteBlob(ID)).toBe(`vault/n-${ID}.bin`);
    expect(imageBlob(ID)).toBe(`vault/i-${ID}.bin`);
  });
  it("produce paths the store guard accepts", () => {
    expect(isValidVaultPath(noteBlob(ID))).toBe(true);
    expect(isValidVaultPath(imageBlob(ID))).toBe(true);
  });
});

describe("isValidVaultPath", () => {
  it("accepts the index, the search index, and both envelope shapes", () => {
    expect(isValidVaultPath(VAULT_INDEX_PATH)).toBe(true);
    expect(isValidVaultPath(VAULT_SEARCH_INDEX_PATH)).toBe(true);
    expect(isValidVaultPath("vault/search-index.bin")).toBe(true);
    expect(isValidVaultPath(`vault/n-${ID}.bin`)).toBe(true);
    expect(isValidVaultPath(`vault/i-${ID}.bin`)).toBe(true);
  });
  it("rejects other stores and traversal", () => {
    expect(isValidVaultPath("meta/keystore")).toBe(false); // another store
    expect(isValidVaultPath("inbox/x")).toBe(false); // wrong prefix
    expect(isValidVaultPath("vault/../x")).toBe(false); // traversal
  });
  it("rejects malformed leaves", () => {
    expect(isValidVaultPath(`vault/n-${ID.slice(0, 21)}.bin`)).toBe(false); // short id
    expect(isValidVaultPath(`vault/x-${ID}.bin`)).toBe(false); // bad prefix letter
    expect(isValidVaultPath(`vault/n-${ID}.txt`)).toBe(false); // bad extension
    expect(isValidVaultPath(`n-${ID}.bin`)).toBe(false); // no vault/ prefix
  });
});

describe("isVaultIndex", () => {
  const valid: VaultIndex = {
    v: 1,
    notes: [
      { id: ID, title: "Note", path: "a.md", modified: "2026-07-11T00:00:00Z" },
    ],
    images: [{ id: ID, name: "p.jpg", path: "Images/p.jpg" }],
  };

  it("passes a well-formed index", () => {
    expect(isVaultIndex(valid)).toBe(true);
    expect(isVaultIndex({ v: 1, notes: [], images: [] })).toBe(true);
  });
  it("tolerates extra fields on the index and its entries", () => {
    expect(
      isVaultIndex({
        v: 1,
        notes: [{ ...valid.notes[0], preview: "hi", h: "abc" }],
        images: [{ ...valid.images[0], h: "def" }],
        extra: "ignored",
      }),
    ).toBe(true);
  });
  it("rejects a bad envelope", () => {
    expect(isVaultIndex(null)).toBe(false);
    expect(isVaultIndex("x")).toBe(false);
    expect(isVaultIndex({ notes: [], images: [] })).toBe(false); // missing v
    expect(isVaultIndex({ v: 2, notes: [], images: [] })).toBe(false); // wrong v
    expect(isVaultIndex({ v: 1, images: [] })).toBe(false); // missing notes
    expect(isVaultIndex({ v: 1, notes: [] })).toBe(false); // missing images
    expect(isVaultIndex({ v: 1, notes: {}, images: [] })).toBe(false); // notes not an array
  });
  it("rejects a malformed entry", () => {
    expect(
      isVaultIndex({
        v: 1,
        notes: [{ id: ID, title: "Note", path: "a.md" }], // no modified
        images: [],
      }),
    ).toBe(false);
    expect(
      isVaultIndex({
        v: 1,
        notes: [],
        images: [{ id: ID, name: "p.jpg" }], // no path
      }),
    ).toBe(false);
  });
});

describe("compareIndexNotes", () => {
  const note = (
    title: string,
    modified: string,
    path = `Journals/${title}.md`,
  ): VaultIndexNote => ({ id: ID, title, path, modified });

  it("orders dated titles by journal day, newest first, ignoring mtime", () => {
    // A backfill import rewrites old notes' files, so mtimes no longer track
    // the journal day — the title date must win over the write order.
    const scrambled = [
      note("2026-07-16", "2026-07-16T06:00:00Z"),
      note("2026-07-13", "2026-07-13T09:00:00Z"),
      note("2026-07-04", "2026-07-04T12:00:00Z"),
      note("2026-07-15", "2026-07-16T05:00:03Z"), // backfilled today
      note("2026-07-14", "2026-07-16T05:00:02Z"), // backfilled today
      note("2026-07-11", "2026-07-16T05:00:01Z"), // backfilled today
    ];
    expect(scrambled.sort(compareIndexNotes).map((n) => n.title)).toEqual([
      "2026-07-16",
      "2026-07-15",
      "2026-07-14",
      "2026-07-13",
      "2026-07-11",
      "2026-07-04",
    ]);
  });
  it("falls back to the modified day for undated titles", () => {
    const sorted = [
      note("Project Ideas", "2026-07-10T08:00:00Z", "Project Ideas.md"),
      note("2026-07-12", "2026-07-16T05:00:00Z"),
      note("2026-07-08", "2026-07-08T20:00:00Z"),
    ].sort(compareIndexNotes);
    expect(sorted.map((n) => n.title)).toEqual([
      "2026-07-12",
      "Project Ideas",
      "2026-07-08",
    ]);
  });
  it("only a title PREFIX counts as a date", () => {
    const dated = note("2026-07-09 trip", "2026-07-16T05:00:00Z");
    const undated = note("notes 2026-07-15", "2026-07-10T00:00:00Z");
    // The mid-title date is NOT a key: "notes 2026-07-15" keys on its modified
    // day (07-10), which beats the dated note's 07-09 prefix.
    expect(
      [dated, undated].sort(compareIndexNotes).map((n) => n.title),
    ).toEqual(["notes 2026-07-15", "2026-07-09 trip"]);
  });
  it("breaks same-day ties newest-modified-first, so duplicate-title first-wins keeps resolving to the newest note", () => {
    const older = note(
      "2026-07-11",
      "2026-07-11T10:00:00Z",
      "Old/2026-07-11.md",
    );
    const newer = note("2026-07-11", "2026-07-16T05:00:00Z");
    expect([older, newer].sort(compareIndexNotes)[0]).toBe(newer);
  });
  it("returns 0 for identical keys (stable for equal entries)", () => {
    const a = note("2026-07-11", "2026-07-11T10:00:00Z");
    expect(compareIndexNotes(a, { ...a })).toBe(0);
  });
});

describe("parseVaultImgId", () => {
  it("extracts the id from a vault embed src", () => {
    expect(parseVaultImgId(`/vault/img/${ID}`)).toBe(ID);
  });
  it("returns null for anything else", () => {
    expect(parseVaultImgId("https://example.com/x.png")).toBe(null);
    expect(parseVaultImgId("data:image/png;base64,AAAA")).toBe(null);
    expect(parseVaultImgId(`/vault/${ID}`)).toBe(null); // a note link, not an img
    expect(parseVaultImgId(`/vault/img/${ID}/extra`)).toBe(null); // trailing junk
    expect(parseVaultImgId(`/vault/img/${ID.slice(0, 21)}`)).toBe(null); // short id
    expect(parseVaultImgId("just some words")).toBe(null);
  });
});

describe("notePreview", () => {
  it("skips frontmatter + a templated heading, returns the first prose line", () => {
    const note =
      "---\ntitle: Daily\ntags: [journal]\n---\n# 2026-07-11\n\nCaught the ferry to Manly.\n";
    expect(notePreview(note)).toBe("Caught the ferry to Manly.");
  });
  it("peels a bullet marker", () => {
    expect(notePreview("- Buy oat milk")).toBe("Buy oat milk");
  });
  it("unwraps a wikilink to its display text, then its target", () => {
    expect(notePreview("[[2026-07-10|yesterday]] was busy")).toBe(
      "2026-07-10 was busy",
    );
    expect(notePreview("See [[Project Ideas]]")).toBe("See Project Ideas");
  });
  it("strips emphasis and a leading task checkbox", () => {
    expect(notePreview("**Big** day today")).toBe("Big day today");
    expect(notePreview("- [x] Ship the vault rebuild")).toBe(
      "Ship the vault rebuild",
    );
  });
  it("returns '' when frontmatter runs past the chunk or nothing prose-like follows", () => {
    expect(notePreview("---\ntitle: x\nstill going")).toBe(""); // unterminated frontmatter
    expect(notePreview("# Only a heading")).toBe("");
    expect(notePreview("")).toBe("");
  });
  it("caps a long line at 140 chars", () => {
    expect(notePreview("x".repeat(300))).toHaveLength(140);
  });
});
