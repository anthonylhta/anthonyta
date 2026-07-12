import { describe, expect, it } from "vitest";
import {
  chunkText,
  cosine,
  dequantize,
  dot,
  normalize,
  parseIndex,
  quantize,
  search,
  serializeIndex,
  type IndexEntry,
  type SearchIndex,
} from "./vectorsearch";

/** A quantized index entry from a raw float vector. */
function entry(id: string, vec: number[], preview?: string): IndexEntry {
  const { q, scale } = quantize(new Float32Array(vec));
  return preview ? { id, q, scale, preview } : { id, q, scale };
}

describe("normalize / dot / cosine", () => {
  it("normalize returns a unit vector, and zero stays zero", () => {
    const n = normalize(new Float32Array([3, 4]));
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
    expect(Array.from(normalize(new Float32Array([0, 0])))).toEqual([0, 0]);
  });
  it("cosine is 1 / 0 / -1 for identical / orthogonal / opposite", () => {
    expect(
      cosine(new Float32Array([1, 1]), new Float32Array([2, 2])),
    ).toBeCloseTo(1, 6);
    expect(
      cosine(new Float32Array([1, 0]), new Float32Array([0, 1])),
    ).toBeCloseTo(0, 6);
    expect(
      cosine(new Float32Array([1, 0]), new Float32Array([-1, 0])),
    ).toBeCloseTo(-1, 6);
  });
  it("cosine is 0 when either vector is zero, and dot rejects a mismatch", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    expect(() => dot(new Float32Array(2), new Float32Array(3))).toThrow(
      /mismatch/,
    );
  });
});

describe("quantize / dequantize", () => {
  it("round-trips within the int8 tolerance", () => {
    const vec = new Float32Array([0.5, -0.25, 1.0, -1.0, 0.1]);
    const { q, scale } = quantize(vec);
    const back = dequantize(q, scale);
    for (let i = 0; i < vec.length; i++) expect(back[i]).toBeCloseTo(vec[i], 1); // ~1/127 resolution
  });
  it("preserves direction — cosine(original, dequantized) ≈ 1", () => {
    const vec = new Float32Array(64);
    for (let i = 0; i < 64; i++) vec[i] = Math.sin(i * 1.3) - 0.2;
    const unit = normalize(vec);
    const { q, scale } = quantize(unit);
    expect(cosine(unit, dequantize(q, scale))).toBeGreaterThan(0.999);
  });
  it("handles the zero vector without NaN", () => {
    const { q, scale } = quantize(new Float32Array(8));
    expect(scale).toBe(1);
    expect(Array.from(dequantize(q, scale))).toEqual(new Array(8).fill(0));
  });
});

describe("serializeIndex / parseIndex", () => {
  const index: SearchIndex = {
    dim: 4,
    entries: [
      entry("note-abc#0", [1, 0, 0, 0], "the first passage"),
      entry("note-xyz#2", [0, 0.7, -0.3, 0.5]),
      entry("日本語#0", [0.1, 0.2, 0.3, 0.4], "unicode id + preview 🗾"),
    ],
  };

  it("round-trips the whole index (ids, scales, vectors, previews)", () => {
    const parsed = parseIndex(serializeIndex(index));
    expect(parsed.dim).toBe(4);
    expect(parsed.entries).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(parsed.entries[i].id).toBe(index.entries[i].id);
      expect(parsed.entries[i].scale).toBeCloseTo(index.entries[i].scale, 6);
      expect(Array.from(parsed.entries[i].q)).toEqual(
        Array.from(index.entries[i].q),
      );
      expect(parsed.entries[i].preview).toBe(index.entries[i].preview);
    }
  });

  it("round-trips an empty index", () => {
    const parsed = parseIndex(serializeIndex({ dim: 8, entries: [] }));
    expect(parsed).toEqual({ dim: 8, entries: [] });
  });

  it("rejects a bad magic and a truncated buffer", () => {
    const bytes = serializeIndex(index);
    const bad = bytes.slice();
    bad[0] ^= 0xff;
    expect(() => parseIndex(bad)).toThrow(/bad magic/);
    expect(() => parseIndex(bytes.subarray(0, 12))).toThrow(/truncated/);
    expect(() => parseIndex(new Uint8Array(3))).toThrow(/truncated/);
  });
});

describe("search", () => {
  const index: SearchIndex = {
    dim: 4,
    entries: [
      entry("a", [1, 0, 0, 0], "east"),
      entry("b", [0, 1, 0, 0], "north"),
      entry("c", [0.9, 0.1, 0, 0], "mostly east"),
      entry("d", [-1, 0, 0, 0], "west"),
    ],
  };

  it("ranks by cosine and respects k", () => {
    const results = search(new Float32Array([1, 0, 0, 0]), index, 2);
    expect(results.map((r) => r.id)).toEqual(["a", "c"]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].preview).toBe("east");
  });

  it("finds the semantically opposite entry last", () => {
    const all = search(new Float32Array([1, 0, 0, 0]), index, 4);
    expect(all.at(-1)!.id).toBe("d"); // opposite direction, lowest cosine
  });

  it("returns [] for k<=0 or an empty index, and rejects a dim mismatch", () => {
    expect(search(new Float32Array([1, 0, 0, 0]), index, 0)).toEqual([]);
    expect(
      search(new Float32Array([1, 0, 0, 0]), { dim: 4, entries: [] }, 5),
    ).toEqual([]);
    expect(() => search(new Float32Array([1, 0]), index, 2)).toThrow(
      /dimension/,
    );
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("just a few words here", 120, 30)).toEqual([
      "just a few words here",
    ]);
  });
  it("splits long text into overlapping chunks covering every word", () => {
    const words = Array.from({ length: 250 }, (_, i) => `w${i}`);
    const chunks = chunkText(words.join(" "), 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    // first/last words present; overlap means consecutive chunks share a tail
    expect(chunks[0].split(" ")[0]).toBe("w0");
    expect(chunks.at(-1)!.split(" ").at(-1)).toBe("w249");
    const firstTail = chunks[0].split(" ").slice(-20);
    const secondHead = chunks[1].split(" ").slice(0, 20);
    expect(firstTail).toEqual(secondHead);
  });
  it("collapses whitespace and drops empty input", () => {
    expect(chunkText("  a\n\n b\t c  ", 120, 30)).toEqual(["a b c"]);
    expect(chunkText("   ", 120, 30)).toEqual([]);
  });
  it("rejects an overlap that isn't smaller than the chunk size", () => {
    expect(() => chunkText("x y z", 10, 10)).toThrow(/overlap/);
  });
});
