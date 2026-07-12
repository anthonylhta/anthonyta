import { describe, expect, it } from "vitest";
import type { Embedder } from "./embedder";
import {
  buildSearchIndex,
  groupByNote,
  noteIdOf,
  type BuildNote,
} from "./searchindex";
import { parseIndex, search, serializeIndex } from "./vectorsearch";

/**
 * A controllable STUB embedder — no model, no download. Bags the ASCII letters of the
 * text into `dim` slots, so texts sharing vocabulary land near each other and the
 * whole build → serialize → search path is exercised deterministically.
 */
function stubEmbedder(dim = 8): Embedder {
  return {
    dim,
    kind: "stub",
    embed(text: string): Promise<Float32Array> {
      const v = new Float32Array(dim);
      for (const ch of text.toLowerCase())
        if (ch >= "a" && ch <= "z") v[ch.charCodeAt(0) % dim] += 1;
      return Promise.resolve(v);
    },
  };
}

/** All entries in an index that belong to one note. */
function entriesFor(index: { entries: { id: string }[] }, noteId: string) {
  return index.entries.filter((e) => noteIdOf(e.id) === noteId);
}

describe("noteIdOf", () => {
  it("takes the part before the last #", () => {
    expect(noteIdOf("abc#0")).toBe("abc");
    expect(noteIdOf("abc#42")).toBe("abc");
    expect(noteIdOf("a#b#2")).toBe("a#b");
  });
  it("returns the id unchanged when there is no chunk suffix", () => {
    expect(noteIdOf("abc")).toBe("abc");
  });
});

describe("groupByNote", () => {
  it("collects entries under their note id, preserving order", () => {
    const index = {
      dim: 2,
      entries: [
        { id: "a#0", q: new Int8Array(2), scale: 1 },
        { id: "b#0", q: new Int8Array(2), scale: 1 },
        { id: "a#1", q: new Int8Array(2), scale: 1 },
      ],
    };
    const grouped = groupByNote(index);
    expect([...grouped.keys()].sort()).toEqual(["a", "b"]);
    expect(grouped.get("a")!.map((e) => e.id)).toEqual(["a#0", "a#1"]);
  });
});

describe("buildSearchIndex", () => {
  const embed = stubEmbedder();

  it("emits one entry per chunk, ids as <noteId>#<i>, dim from the embedder", async () => {
    const notes: BuildNote[] = [
      { id: "AAA", text: "alpha bravo charlie" },
      { id: "BBB", text: "delta echo" },
    ];
    const index = await buildSearchIndex(notes, embed);
    expect(index.dim).toBe(embed.dim);
    expect(index.entries.map((e) => e.id)).toEqual(["AAA#0", "BBB#0"]);
    expect(index.entries[0].preview).toBe("alpha bravo charlie");
  });

  it("splits a long note into several chunks", async () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const index = await buildSearchIndex([{ id: "LONG", text: long }], embed, {
      chunkSize: 100,
      overlap: 20,
    });
    expect(index.entries.length).toBeGreaterThan(1);
    expect(index.entries.every((e) => noteIdOf(e.id) === "LONG")).toBe(true);
  });

  it("skips empty notes (no chunks, no entries)", async () => {
    const index = await buildSearchIndex([{ id: "EMPTY", text: "   " }], embed);
    expect(index.entries).toEqual([]);
  });

  it("caps the passage preview length", async () => {
    const text = "x ".repeat(400); // long single 'x' words
    const index = await buildSearchIndex([{ id: "P", text }], embed, {
      previewLen: 40,
    });
    expect(index.entries[0].preview!.length).toBeLessThanOrEqual(40);
  });

  it("reuses unchanged notes and re-embeds only the changed ones", async () => {
    const first = await buildSearchIndex(
      [
        { id: "A", text: "alpha" },
        { id: "B", text: "bravo" },
        { id: "C", text: "charlie" },
      ],
      embed,
    );
    const reuse = groupByNote(first);

    const second = await buildSearchIndex(
      [
        { id: "A", text: "alpha" }, // unchanged → reuse
        { id: "B", text: "bravo edited" }, // changed → re-embed
        { id: "D", text: "delta" }, // new → embed
      ],
      embed,
      { reuse, changed: new Set(["B"]) },
    );

    // C dropped (not in the note set); A/B/D present.
    expect([...groupByNote(second).keys()].sort()).toEqual(["A", "B", "D"]);
    // A's entries are the very objects carried over from the prior index.
    expect(entriesFor(second, "A")).toEqual(entriesFor(first, "A"));
    expect(entriesFor(second, "A")[0]).toBe(entriesFor(first, "A")[0]);
    // B was re-embedded → a fresh object, not the prior one.
    expect(entriesFor(second, "B")[0]).not.toBe(entriesFor(first, "B")[0]);
  });
});

describe("build → serialize → parse → search (the reader's path, model-free)", () => {
  it("round-trips and ranks the matching note first", async () => {
    const embed = stubEmbedder();
    const notes: BuildNote[] = [
      { id: "riichi", text: "mahjong tenpai waits and yaku" },
      { id: "cash", text: "portfolio holdings rebalance" },
      { id: "ferry", text: "harbour ferry to circular quay" },
    ];
    const built = await buildSearchIndex(notes, embed);

    // Seal-free round-trip: exactly the bytes vault-sync seals and the reader parses.
    const parsed = parseIndex(serializeIndex(built));
    expect(parsed.dim).toBe(embed.dim);

    const query = await embed.embed("mahjong tenpai");
    const results = search(query, parsed, 3);
    expect(results[0].id).toBe("riichi#0");
    expect(noteIdOf(results[0].id)).toBe("riichi");
    expect(results[0].preview).toBe("mahjong tenpai waits and yaku");
  });
});
