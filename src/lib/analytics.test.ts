import { describe, expect, it } from "vitest";
import {
  b64ToBytes,
  bytesToB64,
  DayStats,
  hllAdd,
  hllEstimate,
  hllMerge,
  HLL_REGISTERS,
  isDayStats,
  isSourceTag,
  MAX_TRACKED_PATHS,
  MAX_TRACKED_SOURCES,
  newDaySalt,
  newHll,
  OVERFLOW_PATH,
  pathBucket,
  sourceBucket,
  topPaths,
  topSources,
  visitorHash,
} from "./analytics";

/** A splitmix32 avalanche finalizer — turns a counter into a well-distributed
 *  32-bit value, so the synthetic hashes look uniform to the sketch (as real
 *  SHA-256 hashes would). */
function mix32(n: number): number {
  let z = (n + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

/** Add `n` distinct synthetic hashes to a fresh sketch and return it. */
function sketchOf(n: number, seed = 0): Uint8Array {
  const reg = newHll();
  for (let i = 0; i < n; i++) {
    const x = mix32(Math.imul(seed + 1, 0x9e3779b1) + i);
    hllAdd(reg, new Uint8Array([x >>> 24, x >>> 16, x >>> 8, x]));
  }
  return reg;
}

describe("newDaySalt", () => {
  it("is 16 fresh random bytes each call", () => {
    const a = newDaySalt();
    expect(a.length).toBe(16);
    expect(bytesToB64(a)).not.toBe(bytesToB64(newDaySalt()));
  });
});

describe("visitorHash", () => {
  it("is deterministic in (salt, ip, ua) and 32 bytes", async () => {
    const salt = new Uint8Array(16).fill(7);
    const a = await visitorHash(salt, "203.0.113.5", "Mozilla/5.0");
    const b = await visitorHash(salt, "203.0.113.5", "Mozilla/5.0");
    expect(a.length).toBe(32);
    expect(a).toEqual(b);
  });
  it("a different salt, ip, or ua changes the hash (unlinkable across days)", async () => {
    const s1 = new Uint8Array(16).fill(1);
    const s2 = new Uint8Array(16).fill(2);
    const base = await visitorHash(s1, "ip", "ua");
    expect(await visitorHash(s2, "ip", "ua")).not.toEqual(base); // next day
    expect(await visitorHash(s1, "ip2", "ua")).not.toEqual(base);
    expect(await visitorHash(s1, "ip", "ua2")).not.toEqual(base);
  });
});

describe("HyperLogLog", () => {
  it("a fresh sketch is empty and estimates ~0", () => {
    expect(newHll().length).toBe(HLL_REGISTERS);
    expect(hllEstimate(newHll())).toBe(0);
  });

  it("estimates small cardinalities closely", () => {
    for (const n of [1, 10, 50]) {
      const est = hllEstimate(sketchOf(n));
      // small-range linear counting is tight
      expect(Math.abs(est - n)).toBeLessThanOrEqual(Math.max(2, n * 0.1));
    }
  });

  it("estimates larger cardinalities within the sketch's error bound", () => {
    for (const n of [1000, 5000, 20000]) {
      const est = hllEstimate(sketchOf(n));
      // precision-10 standard error ≈ 3%; allow generous headroom for one draw
      expect(Math.abs(est - n) / n).toBeLessThan(0.1);
    }
  });

  it("is idempotent — re-adding the same hashes doesn't inflate the estimate", () => {
    const a = sketchOf(500);
    const b = sketchOf(500); // same synthetic inputs
    expect(hllEstimate(hllMerge(a, b))).toBe(hllEstimate(a));
  });

  it("merge estimates the union of two disjoint sets", () => {
    const a = sketchOf(1000, 0);
    const b = sketchOf(1000, 1_000_000); // disjoint seed range
    const union = hllEstimate(hllMerge(a, b));
    expect(Math.abs(union - 2000) / 2000).toBeLessThan(0.1);
  });

  it("merge rejects mismatched register lengths", () => {
    expect(() => hllMerge(newHll(), new Uint8Array(8))).toThrow(/mismatch/);
  });

  it("packs and unpacks registers through base64 losslessly", () => {
    const reg = sketchOf(300);
    expect(b64ToBytes(bytesToB64(reg))).toEqual(reg);
  });
});

describe("isDayStats", () => {
  const good: DayStats = {
    v: 1,
    date: "2026-07-12",
    visitors_hll_b64: bytesToB64(sketchOf(10)),
    paths: {
      "/": { views: 42, hll_b64: bytesToB64(sketchOf(8)) },
      "/projects": { views: 7, hll_b64: bytesToB64(sketchOf(3)) },
    },
  };
  it("accepts a well-formed record, including an empty-paths day", () => {
    expect(isDayStats(good)).toBe(true);
    expect(isDayStats({ ...good, paths: {}, visitors_hll_b64: "" })).toBe(true);
  });
  it("rejects a bad version, date, or path stat", () => {
    expect(isDayStats({ ...good, v: 2 })).toBe(false);
    expect(isDayStats({ ...good, date: "2026/07/12" })).toBe(false);
    expect(
      isDayStats({ ...good, paths: { "/": { views: -1, hll_b64: "" } } }),
    ).toBe(false);
    expect(
      isDayStats({ ...good, paths: { "/": { views: 1.5, hll_b64: "" } } }),
    ).toBe(false);
    expect(isDayStats(null)).toBe(false);
  });
  it("accepts a source tally, present or absent", () => {
    expect(isDayStats(good)).toBe(true); // absent — every record before the feature
    expect(isDayStats({ ...good, sources: {} })).toBe(true);
    expect(isDayStats({ ...good, sources: { "/resume?s=seek": 3 } })).toBe(
      true,
    );
  });
  it("rejects a malformed source tally", () => {
    for (const views of [-1, 1.5, "3", null]) {
      expect(
        isDayStats({ ...good, sources: { "/resume?s=seek": views } }),
      ).toBe(false);
    }
    expect(isDayStats({ ...good, sources: null })).toBe(false);
    expect(isDayStats({ ...good, sources: "seek" })).toBe(false);
  });
});

describe("pathBucket (distinct-path cap)", () => {
  /** A record with `n` distinct tracked paths, `/p0`…`/p{n-1}`. */
  const withPaths = (n: number): Record<string, unknown> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`/p${i}`, {}]));

  it("returns the path itself when it is already tracked", () => {
    expect(pathBucket({ "/": {}, "/contact": {} }, "/contact")).toBe(
      "/contact",
    );
  });

  it("returns the path itself while there is room under the cap", () => {
    expect(pathBucket(withPaths(MAX_TRACKED_PATHS - 1), "/fresh")).toBe(
      "/fresh",
    );
  });

  it("folds a new path into the overflow bucket once the cap is reached", () => {
    expect(pathBucket(withPaths(MAX_TRACKED_PATHS), "/fresh")).toBe(
      OVERFLOW_PATH,
    );
  });

  it("keeps updating an already-tracked path even past the cap", () => {
    const paths = { ...withPaths(MAX_TRACKED_PATHS), [OVERFLOW_PATH]: {} };
    // an existing real path stays itself…
    expect(pathBucket(paths, "/p0")).toBe("/p0");
    // …and the overflow bucket, once present, keeps absorbing new paths without
    // counting as further growth (it's already tracked).
    expect(pathBucket(paths, "/brand-new")).toBe(OVERFLOW_PATH);
  });

  it("never mints a bucket key that collides with a real app path", () => {
    // isAppPath requires a leading slash; the overflow key deliberately lacks one.
    expect(OVERFLOW_PATH.startsWith("/")).toBe(false);
  });

  it("honors a smaller explicit cap", () => {
    expect(pathBucket({ "/a": {}, "/b": {} }, "/c", 2)).toBe(OVERFLOW_PATH);
    expect(pathBucket({ "/a": {} }, "/c", 2)).toBe("/c");
  });
});

describe("topPaths", () => {
  it("orders paths by views, with unique estimates", () => {
    const day: DayStats = {
      v: 1,
      date: "2026-07-12",
      visitors_hll_b64: bytesToB64(sketchOf(100)),
      paths: {
        "/": { views: 100, hll_b64: bytesToB64(sketchOf(60)) },
        "/contact": { views: 5, hll_b64: bytesToB64(sketchOf(5)) },
        "/projects": { views: 40, hll_b64: bytesToB64(sketchOf(30)) },
      },
    };
    const ranked = topPaths(day);
    expect(ranked.map((r) => r.path)).toEqual(["/", "/projects", "/contact"]);
    expect(ranked[0].uniques).toBeGreaterThan(ranked[2].uniques);
  });
});

describe("isSourceTag", () => {
  it("accepts the hand-minted tag shape", () => {
    for (const tag of [
      "seek",
      "linkedin",
      "linked-in2",
      "pdf",
      "a",
      "x".repeat(16),
    ])
      expect(isSourceTag(tag)).toBe(true);
  });

  it("rejects anything else — case, length, spaces, punctuation, non-strings", () => {
    for (const junk of [
      "Seek",
      "",
      "x".repeat(17),
      "a b",
      "a?b",
      "a/b",
      "seek\n", // a trailing newline must not slip into a stored key
      "sé",
      42,
      null,
      undefined,
      { tag: "seek" },
    ])
      expect(isSourceTag(junk)).toBe(false);
  });
});

describe("sourceBucket (distinct-source cap)", () => {
  /** A tally already holding `n` distinct source keys. */
  const withSources = (n: number): Record<string, unknown> =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`/resume?s=t${i}`, 1]),
    );

  it("returns the key itself when it is already tallied", () => {
    expect(sourceBucket({ "/resume?s=seek": 4 }, "/resume?s=seek")).toBe(
      "/resume?s=seek",
    );
  });

  it("returns the key itself while there is room under the cap", () => {
    expect(
      sourceBucket(withSources(MAX_TRACKED_SOURCES - 1), "/resume?s=fresh"),
    ).toBe("/resume?s=fresh");
  });

  it("folds a new key into the overflow bucket once the cap is reached", () => {
    expect(
      sourceBucket(withSources(MAX_TRACKED_SOURCES), "/resume?s=fresh"),
    ).toBe(OVERFLOW_PATH);
  });

  it("keeps absorbing into the overflow bucket once it exists", () => {
    const sources = { ...withSources(MAX_TRACKED_SOURCES), [OVERFLOW_PATH]: 2 };
    // an already-tallied key stays itself past the cap…
    expect(sourceBucket(sources, "/resume?s=t0")).toBe("/resume?s=t0");
    // …and the overflow bucket, being tracked, absorbs without further growth.
    expect(sourceBucket(sources, OVERFLOW_PATH)).toBe(OVERFLOW_PATH);
    expect(sourceBucket(sources, "/resume?s=brand-new")).toBe(OVERFLOW_PATH);
  });

  it("honors a smaller explicit cap", () => {
    expect(sourceBucket({ "/a?s=x": 1, "/a?s=y": 1 }, "/a?s=z", 2)).toBe(
      OVERFLOW_PATH,
    );
    expect(sourceBucket({ "/a?s=x": 1 }, "/a?s=z", 2)).toBe("/a?s=z");
  });
});

describe("topSources", () => {
  const day = (sources?: Record<string, number>): DayStats => ({
    v: 1,
    date: "2026-08-30",
    visitors_hll_b64: bytesToB64(sketchOf(10)),
    paths: { "/resume": { views: 13, hll_b64: bytesToB64(sketchOf(9)) } },
    ...(sources ? { sources } : {}),
  });

  it("orders buckets by views, ties broken by key", () => {
    const ranked = topSources(
      day({
        "/resume?s=linkedin": 2,
        "/resume?s=seek": 9,
        "/resume?s=pdf": 2,
      }),
    );
    expect(ranked.map((r) => r.key)).toEqual([
      "/resume?s=seek",
      "/resume?s=linkedin",
      "/resume?s=pdf",
    ]);
    expect(ranked[0].views).toBe(9);
  });

  it("is empty for a day nobody reached through a tagged link", () => {
    expect(topSources(day())).toEqual([]);
  });
});
