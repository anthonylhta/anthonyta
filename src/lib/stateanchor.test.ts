import { describe, expect, it } from "vitest";
import type { AuthEntry } from "./authlog";
import {
  anchorHash,
  anchorVerdict,
  newestEventOf,
  parseAnchor,
  PRF_KINDS,
  withAnchor,
} from "./stateanchor";

const entry = (
  seq: number,
  kind: AuthEntry["kind"],
  detail: string,
): AuthEntry => ({ seq, ts: "2026-07-25T00:00:00Z", kind, detail, h: "x" });

describe("anchorHash", () => {
  it("is deterministic, 16 b64url chars, and content-sensitive", async () => {
    const a = await anchorHash('{"v":2,"x":1}');
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(await anchorHash('{"v":2,"x":1}')).toBe(a);
    expect(await anchorHash('{"v":2,"x":2}')).not.toBe(a);
  });

  it("pins the parse→stringify byte-stability the prf GET relies on", async () => {
    // The route hashes the string it persists; the reader hashes the GET's
    // re-serialization of the parsed object. Same key-ordered shape → same
    // bytes. This is the invariant that must hold for anchoring to work.
    const stored = JSON.stringify({
      v: 1,
      wraps: [
        { v: 1, credential_id_b64: "c", wrapped_mk_b64: "w", iv_b64: "i" },
      ],
    });
    const reserved = JSON.stringify(JSON.parse(stored));
    expect(reserved).toBe(stored);
    expect(await anchorHash(reserved)).toBe(await anchorHash(stored));
  });
});

describe("withAnchor / parseAnchor", () => {
  it("round-trips and rejects malformed tails", () => {
    const detail = withAnchor("wraps 1 → 2", "AAAAAAAAAAAAAAAA");
    expect(detail).toBe("wraps 1 → 2 · state:AAAAAAAAAAAAAAAA");
    expect(parseAnchor(detail)).toBe("AAAAAAAAAAAAAAAA");
    // Pre-feature details carry no anchor.
    expect(parseAnchor("wraps 1 → 2")).toBeNull();
    // A marker with junk after it is not an anchor.
    expect(parseAnchor("x · state:short")).toBeNull();
    expect(parseAnchor("x · state:AAAAAAAAAAAAAAA!")).toBeNull();
  });
});

describe("newestEventOf", () => {
  const entries = [
    entry(1, "keystore", "first-run setup"),
    entry(2, "prf-add", "wraps 0 → 1"),
    entry(3, "keystore", withAnchor("overwritten", "BBBBBBBBBBBBBBBB")),
    entry(4, "signin", "cred #abc"),
  ];

  it("scans from the tail for the newest matching kind", () => {
    expect(newestEventOf(entries, ["keystore"])?.seq).toBe(3);
    expect(newestEventOf(entries, PRF_KINDS)?.seq).toBe(2);
    expect(newestEventOf(entries, ["recovery"])).toBeNull();
    expect(newestEventOf([], ["keystore"])).toBeNull();
  });
});

describe("anchorVerdict", () => {
  it("verified only when the served anchor matches the newest event's", () => {
    const anchored = entry(
      3,
      "keystore",
      withAnchor("overwritten", "BBBBBBBBBBBBBBBB"),
    );
    expect(anchorVerdict("BBBBBBBBBBBBBBBB", anchored)).toBe("verified");
    expect(anchorVerdict("CCCCCCCCCCCCCCCC", anchored)).toBe("mismatch");
  });

  it("newest-unanchored reads unanchored even when an OLDER event carries the anchor", () => {
    // A rollback serves old state matching an OLD anchor — comparing against
    // anything but the newest event would bless exactly that. The verdict fn
    // takes only the newest event; feeding it a pre-feature newest → unanchored.
    const preFeature = entry(5, "keystore", "overwritten (passphrase change)");
    expect(anchorVerdict("BBBBBBBBBBBBBBBB", preFeature)).toBe("unanchored");
    expect(anchorVerdict("BBBBBBBBBBBBBBBB", null)).toBe("unanchored");
  });
});
