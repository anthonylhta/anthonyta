import { describe, expect, it } from "vitest";
import {
  buildManifest,
  buildRoot,
  carryForward,
  compareEpoch,
  diffEntries,
  hashBytes,
  isManifest,
  verifyManifest,
  type ManifestEntry,
  type VaultManifest,
} from "./merkle";

// A small set of well-formed entries. `h` is just a b64url-ish token here — the
// Merkle math treats it as an opaque string; the real callers put SHA-256s there.
const entry = (path: string, h: string): ManifestEntry => ({ path, h });
const SET: ManifestEntry[] = [
  entry("vault/a.bin", "AAAA"),
  entry("vault/b.bin", "BBBB"),
  entry("vault/c.bin", "CCCC"),
];

// A Fisher-Yates-free shuffle: reverse + rotate is enough to change input order.
const shuffled = (es: ManifestEntry[]): ManifestEntry[] => {
  const out = [...es].reverse();
  out.push(out.shift()!);
  return out;
};

describe("hashBytes", () => {
  it("is deterministic b64url SHA-256 over the bytes", async () => {
    const bytes = new TextEncoder().encode("envelope");
    const h = await hashBytes(bytes);
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(h).toBe(await hashBytes(new TextEncoder().encode("envelope")));
  });
  it("changes when a single byte changes", async () => {
    expect(await hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(
      await hashBytes(new Uint8Array([1, 2, 4])),
    );
  });
});

describe("buildRoot — determinism + order-independence", () => {
  it("same entries, shuffled input order, gives the identical root", async () => {
    const a = await buildRoot(SET);
    const b = await buildRoot(shuffled(SET));
    const c = await buildRoot([...SET].sort(() => 1)); // yet another order
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("buildRoot — single-byte sensitivity", () => {
  it("flipping one char of one entry's h changes the root and diffEntries names that path", async () => {
    const before = await buildRoot(SET);
    const tampered = SET.map((e) =>
      e.path === "vault/b.bin" ? entry(e.path, "BBBC") : e,
    );
    const after = await buildRoot(tampered);
    expect(after).not.toBe(before);
    expect(diffEntries(SET, tampered)).toEqual({
      changed: ["vault/b.bin"],
      missing: [],
      added: [],
    });
  });
});

describe("diffEntries — deletion + addition", () => {
  it("names the exact missing/added paths and the root changes", async () => {
    const current = [
      entry("vault/a.bin", "AAAA"),
      // b.bin deleted
      entry("vault/c.bin", "CCCC"),
      entry("vault/d.bin", "DDDD"), // added
    ];
    expect(diffEntries(SET, current)).toEqual({
      changed: [],
      missing: ["vault/b.bin"],
      added: ["vault/d.bin"],
    });
    expect(await buildRoot(current)).not.toBe(await buildRoot(SET));
  });
  it("sorts each list ascending for stable output", () => {
    const prior = [
      entry("z", "1"),
      entry("m", "1"),
      entry("a", "1"),
      entry("keep", "1"),
    ];
    const current = [
      entry("keep", "1"),
      entry("y", "2"),
      entry("b", "2"),
      entry("n", "2"),
    ];
    expect(diffEntries(prior, current)).toEqual({
      changed: [],
      missing: ["a", "m", "z"],
      added: ["b", "n", "y"],
    });
  });
});

describe("buildRoot — edges", () => {
  it("the empty root is stable and distinct from a single leaf", async () => {
    const empty = await buildRoot([]);
    expect(empty).toBe(await buildRoot([])); // stable
    expect(empty).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(empty).not.toBe(await buildRoot([entry("vault/a.bin", "AAAA")]));
  });
  it("folds a single leaf, two leaves, and odd counts (3, 5) without error", async () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => entry(`vault/${i}.bin`, `h${i}`));
    for (const n of [1, 2, 3, 5]) {
      const es = mk(n);
      const root = await buildRoot(es);
      expect(root).toMatch(/^[A-Za-z0-9_-]+$/);
      // odd counts fold and stay order-independent
      expect(root).toBe(await buildRoot(shuffled(es)));
    }
  });
  it("gives different-sized sets different roots", async () => {
    const two = [entry("a", "1"), entry("b", "2")];
    const three = [...two, entry("c", "3")];
    expect(await buildRoot(two)).not.toBe(await buildRoot(three));
  });
});

describe("buildRoot — domain separation", () => {
  it("does not collide entries a naive concat would merge", async () => {
    // "a b" ‖ "c"  vs  "a" ‖ "b c": without the NUL separator between path and h,
    // both would hash the same joined string. The "leaf\0…\0…" framing keeps them apart.
    const r1 = await buildRoot([entry("a b", "c")]);
    const r2 = await buildRoot([entry("a", "b c")]);
    expect(r1).not.toBe(r2);
  });
  it("a leaf and an interior node are never confusable", async () => {
    // Two leaves fold into one interior node. A single leaf whose fields, naively
    // concatenated, echo the node's children must still produce a different root —
    // the "leaf\0" vs "node\0" prefixes guarantee it.
    const two = await buildRoot([entry("x", "1"), entry("y", "2")]);
    const one = await buildRoot([entry("xy", "12")]);
    expect(two).not.toBe(one);
  });
});

describe("isManifest", () => {
  let valid: VaultManifest;
  it("accepts a round-tripped manifest (and tolerates extra fields)", async () => {
    valid = await buildManifest(SET, 3);
    expect(isManifest(valid)).toBe(true);
    expect(isManifest({ ...valid, note: "forward-compat" })).toBe(true);
    expect(isManifest(await buildManifest([], 1))).toBe(true); // empty is valid
  });
  it("rejects non-objects and wrong version", () => {
    expect(isManifest(null)).toBe(false);
    expect(isManifest("x")).toBe(false);
    expect(isManifest(42)).toBe(false);
    expect(isManifest({ ...valid, v: 2 })).toBe(false);
  });
  it("rejects a bad epoch (0, negative, non-integer, non-number)", () => {
    expect(isManifest({ ...valid, epoch: 0 })).toBe(false);
    expect(isManifest({ ...valid, epoch: -1 })).toBe(false);
    expect(isManifest({ ...valid, epoch: 1.5 })).toBe(false);
    expect(isManifest({ ...valid, epoch: "1" })).toBe(false);
  });
  it("rejects a count that disagrees with entries.length", () => {
    expect(isManifest({ ...valid, count: valid.count + 1 })).toBe(false);
  });
  it("rejects a non-string root and missing fields", () => {
    expect(isManifest({ ...valid, root: 123 })).toBe(false);
    expect(
      isManifest({
        v: 1,
        epoch: valid.epoch,
        count: valid.count,
        entries: valid.entries,
      }),
    ).toBe(false); // no root
    expect(
      isManifest({
        v: 1,
        epoch: valid.epoch,
        root: valid.root,
        count: valid.count,
      }),
    ).toBe(false); // no entries
  });
  it("rejects malformed entries and duplicate paths", () => {
    expect(isManifest({ ...valid, count: 1, entries: [{ path: "a" }] })).toBe(
      false,
    ); // no h
    expect(isManifest({ ...valid, count: 1, entries: [{ h: "x" }] })).toBe(
      false,
    ); // no path
    expect(
      isManifest({ ...valid, count: 1, entries: [{ path: "a", h: 1 }] }),
    ).toBe(false); // non-string h
    expect(
      isManifest({
        ...valid,
        count: 2,
        entries: [entry("dup", "1"), entry("dup", "2")],
      }),
    ).toBe(false); // duplicate path
  });
});

describe("verifyManifest", () => {
  it("is true for a freshly built manifest", async () => {
    expect(await verifyManifest(await buildManifest(SET, 1))).toBe(true);
    expect(await verifyManifest(await buildManifest([], 1))).toBe(true);
  });
  it("is false when the root is swapped for another valid-looking root", async () => {
    const m = await buildManifest(SET, 1);
    const otherRoot = await buildRoot([entry("vault/z.bin", "ZZZZ")]);
    expect(otherRoot).toMatch(/^[A-Za-z0-9_-]+$/); // a real, valid-looking root
    expect(await verifyManifest({ ...m, root: otherRoot })).toBe(false);
  });
  it("is false when an entry is edited after the manifest was built", async () => {
    const m = await buildManifest(
      SET.map((e) => ({ ...e })),
      1,
    );
    m.entries[0].h = "TAMPERED";
    expect(await verifyManifest(m)).toBe(false);
  });
});

describe("compareEpoch", () => {
  it("trusts the first sync and any non-decreasing epoch", () => {
    expect(compareEpoch(null, 1)).toBe("ok"); // first sync
    expect(compareEpoch(5, 7)).toBe("ok"); // advanced
    expect(compareEpoch(5, 5)).toBe("ok"); // unchanged
  });
  it("flags a rollback when the served epoch regresses", () => {
    expect(compareEpoch(7, 5)).toBe("rolled-back");
  });
});

describe("carryForward", () => {
  const prior: VaultManifest = {
    v: 1,
    epoch: 2,
    root: "ignored-by-carryForward",
    count: 3,
    entries: [
      entry("vault/a.bin", "priorA"),
      entry("vault/b.bin", "priorB"),
      entry("vault/gone.bin", "priorGone"), // no longer current
    ],
  };

  it("fresh hash wins; prior fills the rest; unknown paths backfill (not in entries)", () => {
    const currentPaths = ["vault/a.bin", "vault/b.bin", "vault/new.bin"];
    const fresh = new Map([["vault/a.bin", "freshA"]]);
    const { entries, backfill } = carryForward(prior, currentPaths, fresh);
    expect(entries).toEqual([
      entry("vault/a.bin", "freshA"), // fresh wins over priorA
      entry("vault/b.bin", "priorB"), // carried forward
    ]);
    expect(backfill).toEqual(["vault/new.bin"]); // in neither → backfill
    // and the backfilled path is NOT in entries
    expect(entries.some((e) => e.path === "vault/new.bin")).toBe(false);
  });
  it("result entries follow currentPaths order", () => {
    const currentPaths = ["vault/b.bin", "vault/a.bin"];
    const { entries } = carryForward(prior, currentPaths, new Map());
    expect(entries.map((e) => e.path)).toEqual(["vault/b.bin", "vault/a.bin"]);
  });
  it("drops prior entries for paths no longer current", () => {
    const { entries } = carryForward(
      prior,
      ["vault/a.bin"],
      new Map([["vault/a.bin", "freshA"]]),
    );
    expect(entries).toEqual([entry("vault/a.bin", "freshA")]);
    expect(entries.some((e) => e.path === "vault/gone.bin")).toBe(false);
  });
  it("with prior=null, every non-fresh path is a backfill", () => {
    const currentPaths = ["vault/a.bin", "vault/b.bin"];
    const { entries, backfill } = carryForward(
      null,
      currentPaths,
      new Map([["vault/a.bin", "freshA"]]),
    );
    expect(entries).toEqual([entry("vault/a.bin", "freshA")]);
    expect(backfill).toEqual(["vault/b.bin"]);
  });
});
