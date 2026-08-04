import { describe, expect, it } from "vitest";

import {
  buildHandoff,
  HANDOFF_TTL_MS,
  handoffSlot,
  parseKeyFragment,
  readHandoff,
  stripFragment,
} from "./fragkey";

const KEY = "A".repeat(43); // well-formed 32-byte b64url key shape

describe("parseKeyFragment", () => {
  it("accepts a bare key and a #-prefixed one identically", () => {
    expect(parseKeyFragment(KEY)).toBe(KEY);
    expect(parseKeyFragment(`#${KEY}`)).toBe(KEY);
  });

  it("rejects empty and #-only hashes", () => {
    expect(parseKeyFragment("")).toBeNull();
    expect(parseKeyFragment("#")).toBeNull();
  });

  it("rejects a key one char short or long — a truncated copy must read as missing", () => {
    expect(parseKeyFragment("A".repeat(42))).toBeNull();
    expect(parseKeyFragment("A".repeat(44))).toBeNull();
  });

  it("rejects standard-base64 and junk characters", () => {
    expect(parseKeyFragment("A".repeat(42) + "+")).toBeNull();
    expect(parseKeyFragment("A".repeat(42) + "/")).toBeNull();
    expect(parseKeyFragment("A".repeat(42) + "=")).toBeNull();
    expect(parseKeyFragment("A".repeat(42) + "😀")).toBeNull();
  });

  it("accepts the full b64url alphabet", () => {
    const mixed = "Az09_-".repeat(7) + "A"; // 43 chars
    expect(parseKeyFragment(mixed)).toBe(mixed);
  });
});

describe("stripFragment", () => {
  it("removes the fragment and keeps everything before it", () => {
    expect(stripFragment(`https://x.dev/s/abc#${KEY}`)).toBe(
      "https://x.dev/s/abc",
    );
  });

  it("preserves a query string", () => {
    expect(stripFragment(`https://x.dev/s/abc?q=1#${KEY}`)).toBe(
      "https://x.dev/s/abc?q=1",
    );
  });

  it("is a no-op without a fragment", () => {
    expect(stripFragment("https://x.dev/s/abc")).toBe("https://x.dev/s/abc");
  });

  it("cuts at the FIRST # even if the fragment contains another", () => {
    expect(stripFragment("https://x.dev/s/abc#a#b")).toBe(
      "https://x.dev/s/abc",
    );
  });
});

describe("handoff", () => {
  const NOW = 1_750_000_000_000;

  it("round-trips a key within the TTL", () => {
    const stored = buildHandoff(KEY, NOW);
    expect(readHandoff(stored, NOW)).toBe(KEY);
    expect(readHandoff(stored, NOW + HANDOFF_TTL_MS - 1)).toBe(KEY);
  });

  it("expires at exactly the TTL boundary", () => {
    const stored = buildHandoff(KEY, NOW);
    expect(readHandoff(stored, NOW + HANDOFF_TTL_MS)).toBeNull();
  });

  it("reads absent storage as no key", () => {
    expect(readHandoff(null, NOW)).toBeNull();
  });

  it("reads garbage as no key, never throws", () => {
    for (const junk of ["", "not json", "[]", "42", '"str"', "{}", "null"]) {
      expect(readHandoff(junk, NOW)).toBeNull();
    }
  });

  it("rejects a wrong version, a malformed key, and a non-finite expiry", () => {
    expect(
      readHandoff(JSON.stringify({ v: 2, k: KEY, exp: NOW + 1000 }), NOW),
    ).toBeNull();
    expect(
      readHandoff(JSON.stringify({ v: 1, k: "short", exp: NOW + 1000 }), NOW),
    ).toBeNull();
    expect(
      readHandoff(JSON.stringify({ v: 1, k: KEY, exp: "soon" }), NOW),
    ).toBeNull();
    // JSON can't carry Infinity/NaN directly, but a null exp must also die.
    expect(
      readHandoff(JSON.stringify({ v: 1, k: KEY, exp: null }), NOW),
    ).toBeNull();
  });

  it("names one slot per share id", () => {
    expect(handoffSlot("abc")).toBe("sharekey:abc");
    expect(handoffSlot("abc")).not.toBe(handoffSlot("xyz"));
  });
});
