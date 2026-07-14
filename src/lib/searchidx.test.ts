import { describe, expect, it } from "vitest";
import {
  buildIndex,
  deserializeIndex,
  emptyIndex,
  highlightSegments,
  indexStats,
  INDEX_VERSION,
  MAX_POSITIONS_PER_TOKEN,
  query,
  removeDoc,
  serializeIndex,
  trigrams,
  updateDoc,
  type IndexDoc,
} from "./searchidx";

// ---------------------------------------------------------------------------
// tokenizer
// ---------------------------------------------------------------------------

describe("trigrams (tokenizer)", () => {
  it("case-folds and slides a 3-char window over English", () => {
    expect(trigrams("Hello")).toEqual(["hel", "ell", "llo"]);
  });

  it("treats CJK with the identical mechanism — no dictionary", () => {
    expect(trigrams("日本語")).toEqual(["日本語"]);
    expect(trigrams("東京タワー")).toEqual(["東京タ", "京タワ", "タワー"]);
  });

  it("NFKC-folds full-width and composed forms before tokenizing", () => {
    expect(trigrams("ＡＢＣ")).toEqual(trigrams("abc")); // full-width → ascii
    expect(trigrams("１２３")).toEqual(["123"]);
    // composed "\u00e9" and decomposed "e"+combining-acute fold alike
    expect(trigrams("caf\u00e9")).toEqual(trigrams("cafe\u0301"));
  });

  it("collapses whitespace runs so a query can span a word boundary", () => {
    expect(trigrams("a   b")).toEqual(trigrams("a b"));
    expect(trigrams("foo\n\tbar")).toEqual(trigrams("foo bar"));
  });

  it("keeps astral code points whole (no surrogate split)", () => {
    expect(trigrams("🗾ab")).toEqual(["🗾ab"]);
  });

  it("yields nothing for text shorter than a trigram", () => {
    expect(trigrams("hi")).toEqual([]);
    expect(trigrams("  ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// build + query relevance
// ---------------------------------------------------------------------------

const corpus: IndexDoc[] = [
  {
    id: "riichi",
    title: "Riichi puzzles",
    text: "mahjong tenpai waits and yaku",
  },
  {
    id: "cash",
    title: "Portfolio",
    text: "holdings rebalance and cash buffer",
  },
  { id: "ferry", title: "Ferry log", text: "harbour ferry to circular quay" },
  { id: "tokyo", title: "東京メモ", text: "東京タワーに登った日本語の記録" },
];

describe("build + query", () => {
  it("finds an exact word and returns it, tie-broken by id", () => {
    const idx = buildIndex(corpus);
    const hits = query(idx, "mahjong");
    expect(hits.map((h) => h.id)).toContain("riichi");
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });

  it("matches a substring that is not word-aligned", () => {
    const idx = buildIndex(corpus);
    // "enpa" is inside "tenpai"
    expect(query(idx, "enpa").map((h) => h.id)).toEqual(["riichi"]);
  });

  it("matches across a word boundary (whitespace collapsed)", () => {
    const idx = buildIndex(corpus);
    // "ry to" spans "ferry to"
    expect(query(idx, "ry to").map((h) => h.id)).toEqual(["ferry"]);
  });

  it("rejects a doc that only scatters the trigrams (no false positive)", () => {
    // "abc xbcd" holds BOTH of "abcd"'s trigrams ("abc" and "bcd") but never
    // contiguously, so positional verification must reject it — while a doc that
    // does have "abcd" whole is found.
    const idx = buildIndex([
      { id: "scatter", title: "", text: "abc xbcd" },
      { id: "whole", title: "", text: "zz abcd zz" },
    ]);
    expect(query(idx, "abcd").map((h) => h.id)).toEqual(["whole"]);
  });

  it("ranks a title match above a body-only match", () => {
    const idx = buildIndex([
      { id: "t", title: "ferry timetable", text: "nothing relevant here" },
      { id: "b", title: "daily log", text: "took the ferry across" },
    ]);
    const hits = query(idx, "ferry");
    expect(hits[0].id).toBe("t");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("counts repeated occurrences into the tf score", () => {
    const idx = buildIndex([
      { id: "one", title: "x", text: "ferry" },
      { id: "many", title: "x", text: "ferry ferry ferry" },
    ]);
    const hits = query(idx, "ferry");
    const many = hits.find((h) => h.id === "many")!;
    const one = hits.find((h) => h.id === "one")!;
    expect(many.score).toBeGreaterThan(one.score);
  });

  it("searches CJK bodies through the same path", () => {
    const idx = buildIndex(corpus);
    expect(query(idx, "東京タワー").map((h) => h.id)).toEqual(["tokyo"]);
    expect(query(idx, "日本語").map((h) => h.id)).toEqual(["tokyo"]);
  });

  it("honours k and returns nothing for k<=0 or an unknown term", () => {
    const idx = buildIndex(corpus);
    expect(query(idx, "and", 1)).toHaveLength(1);
    expect(query(idx, "mahjong", 0)).toEqual([]);
    expect(query(idx, "zzzzz")).toEqual([]);
  });
});

describe("short-query prefix fallback", () => {
  it("prefix-scans a 1–2 char query instead of intersecting trigrams", () => {
    const idx = buildIndex([
      { id: "fe", title: "", text: "ferry" },
      { id: "ca", title: "", text: "cash" },
    ]);
    // "fe" is a prefix of the trigram "fer" → hits the ferry doc, not cash.
    expect(query(idx, "fe").map((h) => h.id)).toEqual(["fe"]);
    expect(query(idx, "c").map((h) => h.id)).toEqual(["ca"]);
  });

  it("returns nothing for an empty or whitespace query", () => {
    const idx = buildIndex(corpus);
    expect(query(idx, "")).toEqual([]);
    expect(query(idx, "   ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// incremental updates
// ---------------------------------------------------------------------------

describe("updateDoc / removeDoc", () => {
  it("upserts and removes, touching only the doc's postings", () => {
    const idx = emptyIndex();
    updateDoc(idx, { id: "a", title: "", text: "mahjong" });
    updateDoc(idx, { id: "b", title: "", text: "portfolio" });
    expect(query(idx, "mahjong").map((h) => h.id)).toEqual(["a"]);

    // edit a: its old body no longer matches, its new one does; b is untouched.
    updateDoc(idx, { id: "a", title: "", text: "ferry" });
    expect(query(idx, "mahjong")).toEqual([]);
    expect(query(idx, "ferry").map((h) => h.id)).toEqual(["a"]);
    expect(query(idx, "portfolio").map((h) => h.id)).toEqual(["b"]);

    removeDoc(idx, "a");
    expect(query(idx, "ferry")).toEqual([]);
    expect(query(idx, "portfolio").map((h) => h.id)).toEqual(["b"]);
  });

  it("removing an unknown id is a no-op", () => {
    const idx = buildIndex([{ id: "a", title: "", text: "hello world" }]);
    const before = serializeIndex(idx);
    removeDoc(idx, "ghost");
    expect(serializeIndex(idx)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// the equivalence property — the invariant that earns trust in incrementality
// ---------------------------------------------------------------------------

describe("equivalence property: incremental ≡ rebuild, byte for byte", () => {
  // Deterministic LCG so a failure reproduces exactly.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
  const words = [
    "mahjong",
    "riichi",
    "tenpai",
    "ferry",
    "harbour",
    "portfolio",
    "cash",
    "note",
    "alpha",
    "bravo",
    "日本語",
    "東京",
    "タワー",
    "の",
  ];

  it("40 random edit sequences all reconcile with a from-scratch build", () => {
    const rand = rng(0xc0ffee);
    const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
    const makeText = () =>
      Array.from({ length: 1 + Math.floor(rand() * 12) }, () =>
        pick(words),
      ).join(" ");

    for (let trial = 0; trial < 40; trial++) {
      const live = new Map<string, IndexDoc>();
      const idx = emptyIndex();
      const ops = 30 + Math.floor(rand() * 40);
      for (let i = 0; i < ops; i++) {
        const id = "d" + Math.floor(rand() * 8); // small id space → real upserts
        if (rand() < 0.25 && live.has(id)) {
          live.delete(id);
          removeDoc(idx, id);
        } else {
          const doc: IndexDoc = { id, title: makeText(), text: makeText() };
          live.set(id, doc);
          updateDoc(idx, doc);
        }
      }
      const rebuilt = buildIndex([...live.values()]);
      // The whole point: byte-for-byte after canonical serialization.
      expect(serializeIndex(idx)).toEqual(serializeIndex(rebuilt));
    }
  });
});

// ---------------------------------------------------------------------------
// serialization round-trip + guard matrix
// ---------------------------------------------------------------------------

describe("serialize / deserialize", () => {
  it("round-trips ids, titleLen, postings, and Unicode trigrams", () => {
    const idx = buildIndex(corpus);
    const back = deserializeIndex(serializeIndex(idx));
    // Re-serializing the parsed index is byte-identical (canonical + faithful parse).
    expect(serializeIndex(back)).toEqual(serializeIndex(idx));
    expect(back.version).toBe(INDEX_VERSION);
    // Queries behave identically on the parsed index.
    for (const q of ["ferry", "東京タワー", "enpa", "fe"])
      expect(query(back, q)).toEqual(query(idx, q));
  });

  it("round-trips an empty index", () => {
    const back = deserializeIndex(serializeIndex(emptyIndex()));
    expect(indexStats(back)).toEqual({ docs: 0, tokens: 0, positions: 0 });
    expect(query(back, "anything")).toEqual([]);
  });

  it("round-trips a single-doc index", () => {
    const idx = buildIndex([
      { id: "solo", title: "T", text: "just one note here" },
    ]);
    const back = deserializeIndex(serializeIndex(idx));
    expect(query(back, "note").map((h) => h.id)).toEqual(["solo"]);
  });

  it("keeps a doc with no trigrams in the table", () => {
    const idx = buildIndex([{ id: "empty", title: "", text: "" }]);
    expect(indexStats(idx).docs).toBe(1);
    const back = deserializeIndex(serializeIndex(idx));
    expect(indexStats(back).docs).toBe(1);
  });

  it("rejects a bad magic, an unknown version, truncation, and a bad doc ref", () => {
    const bytes = serializeIndex(buildIndex(corpus));

    const badMagic = bytes.slice();
    badMagic[0] ^= 0xff;
    expect(() => deserializeIndex(badMagic)).toThrow(/bad magic/);

    const badVersion = bytes.slice();
    new DataView(badVersion.buffer).setUint32(4, 999);
    expect(() => deserializeIndex(badVersion)).toThrow(/bad version/);

    expect(() => deserializeIndex(bytes.subarray(0, 10))).toThrow(/truncated/);
    expect(() => deserializeIndex(new Uint8Array(3))).toThrow(/truncated/);

    // Point the first posting at an out-of-range doc index.
    const badRef = corruptFirstDocRef(bytes);
    expect(() => deserializeIndex(badRef)).toThrow(/bad doc ref/);
  });
});

/** Overwrite the first posting's docIndex with a value past docCount. */
function corruptFirstDocRef(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  let o = 4 + 4; // magic + version
  const docCount = view.getUint32(o);
  o += 4;
  for (let i = 0; i < docCount; i++) {
    const idLen = view.getUint16(o);
    o += 2 + idLen + 4; // id + titleLen
  }
  o += 4; // tokenCount
  const tokLen = view.getUint8(o);
  o += 1 + tokLen + 4; // tok + postingCount → first posting docIndex
  view.setUint32(o, docCount + 5);
  return out;
}

// ---------------------------------------------------------------------------
// posting cap + size accounting
// ---------------------------------------------------------------------------

describe("postings cap + size accounting", () => {
  it("caps positions per (trigram, doc) so a repetitive note can't balloon", () => {
    const idx = buildIndex([{ id: "spam", title: "", text: "a".repeat(5000) }]);
    const positions = idx.inverted.get("aaa")!.get("spam")!;
    expect(positions.length).toBe(MAX_POSITIONS_PER_TOKEN);
    // …and the cap survives a serialize round-trip.
    const back = deserializeIndex(serializeIndex(idx));
    expect(back.inverted.get("aaa")!.get("spam")!.length).toBe(
      MAX_POSITIONS_PER_TOKEN,
    );
  });

  it("reports doc / trigram / position counts", () => {
    const idx = buildIndex([{ id: "a", title: "", text: "abcabc" }]);
    const stats = indexStats(idx);
    expect(stats.docs).toBe(1);
    expect(stats.tokens).toBeGreaterThan(0);
    expect(stats.positions).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// highlight helper
// ---------------------------------------------------------------------------

describe("highlightSegments", () => {
  it("splits into hit / non-hit around a case-insensitive match", () => {
    expect(highlightSegments("Ferry to Manly", "ferry")).toEqual([
      { text: "Ferry", hit: true },
      { text: " to Manly", hit: false },
    ]);
  });

  it("marks every occurrence and preserves the original text exactly", () => {
    const segs = highlightSegments("aXaXa", "a");
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual([
      "a",
      "a",
      "a",
    ]);
    expect(segs.map((s) => s.text).join("")).toBe("aXaXa");
  });

  it("returns one non-hit segment when nothing matches or the query is empty", () => {
    expect(highlightSegments("hello", "zzz")).toEqual([
      { text: "hello", hit: false },
    ]);
    expect(highlightSegments("hello", "")).toEqual([
      { text: "hello", hit: false },
    ]);
  });

  it("handles empty text and CJK", () => {
    expect(highlightSegments("", "x")).toEqual([]);
    expect(highlightSegments("東京タワー", "タワー")).toEqual([
      { text: "東京", hit: false },
      { text: "タワー", hit: true },
    ]);
  });
});
