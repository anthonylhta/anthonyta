import { describe, expect, it } from "vitest";
import { combine, formatShare, parseShare, split, type Share } from "./shamir";

const SECRET = new TextEncoder().encode("correct horse battery staple!!!!"); // 32B

/** Every k-sized subset of `arr` (for exhaustive subset-reconstruction tests). */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map((c) => [head, ...c]),
    ...combinations(rest, k),
  ];
}

describe("split / combine", () => {
  it("round-trips a 32-byte secret (the master-key size)", () => {
    const shares = split(SECRET, 5, 3);
    expect(shares).toHaveLength(5);
    expect(shares.map((s) => s.x)).toEqual([1, 2, 3, 4, 5]);
    expect(combine(shares.slice(0, 3))).toEqual(SECRET);
  });

  it("ANY threshold-sized subset reconstructs (exhaustive for 5-choose-3)", () => {
    const shares = split(SECRET, 5, 3);
    for (const subset of combinations(shares, 3)) {
      expect(combine(subset)).toEqual(SECRET);
    }
  });

  it("more than the threshold also reconstructs (overdetermined, consistent)", () => {
    const shares = split(SECRET, 5, 3);
    expect(combine(shares.slice(0, 4))).toEqual(SECRET);
    expect(combine(shares)).toEqual(SECRET);
  });

  it("fewer than the threshold does NOT reveal the secret", () => {
    const shares = split(SECRET, 5, 3);
    // combine tolerates 2 points but interpolates a different constant term.
    expect(combine(shares.slice(0, 2))).not.toEqual(SECRET);
  });

  it("works across several (n, k) shapes and a range of byte values", () => {
    const secret = new Uint8Array(64);
    for (let i = 0; i < 64; i++) secret[i] = (i * 7 + 3) & 0xff;
    for (const [n, k] of [
      [2, 2],
      [3, 2],
      [10, 7],
      [255, 2],
    ] as const) {
      const shares = split(secret, n, k);
      expect(shares).toHaveLength(n);
      // the highest-x k shares — a subset that isn't just indices 0..k-1
      expect(combine(shares.slice(n - k))).toEqual(secret);
    }
  });

  it("handles the all-zero and all-0xff secret", () => {
    for (const fill of [0x00, 0xff]) {
      const s = new Uint8Array(16).fill(fill);
      expect(combine(split(s, 4, 2).slice(0, 2))).toEqual(s);
    }
  });

  it("is fresh per call — different shares, same reconstruction", () => {
    const a = split(SECRET, 3, 2);
    const b = split(SECRET, 3, 2);
    expect(a[0].y).not.toEqual(b[0].y); // random coefficients
    expect(combine(a.slice(0, 2))).toEqual(combine(b.slice(0, 2)));
  });
});

describe("split validation", () => {
  it("rejects out-of-range parameters and empty secrets", () => {
    expect(() => split(SECRET, 3, 1)).toThrow(/threshold/);
    expect(() => split(SECRET, 2, 3)).toThrow(/n must be >= threshold/);
    expect(() => split(SECRET, 256, 2)).toThrow(/at most 255/);
    expect(() => split(new Uint8Array(0), 3, 2)).toThrow(/non-empty/);
    expect(() => split(SECRET, 3.5, 2)).toThrow(/integers/);
  });
});

describe("combine validation", () => {
  it("rejects duplicate x, length mismatch, out-of-range x, and empty sets", () => {
    const shares = split(SECRET, 5, 3);
    expect(() => combine([])).toThrow(/no shares/);
    expect(() => combine([shares[0], shares[0]])).toThrow(/duplicate/);
    const bad: Share = { x: 2, y: new Uint8Array(5) };
    expect(() => combine([shares[0], bad])).toThrow(/length mismatch/);
    expect(() => combine([{ x: 0, y: shares[0].y }])).toThrow(/out of range/);
  });
});

describe("formatShare / parseShare", () => {
  it("round-trips a share through the QR wire format", () => {
    const shares = split(SECRET, 5, 3);
    for (const s of shares) {
      const parsed = parseShare(formatShare(s, 3));
      expect(parsed).not.toBeNull();
      expect(parsed!.threshold).toBe(3);
      expect(parsed!.share.x).toBe(s.x);
      expect(parsed!.share.y).toEqual(s.y);
    }
  });

  it("parsed shares reconstruct end-to-end (format → parse → combine)", () => {
    const shares = split(SECRET, 5, 3);
    const round = shares
      .slice(0, 3)
      .map((s) => parseShare(formatShare(s, 3))!.share);
    expect(combine(round)).toEqual(SECRET);
  });

  it("is base64url-safe (no +, /, or = in the payload)", () => {
    const payload = formatShare(split(SECRET, 3, 2)[0], 2);
    expect(payload).not.toMatch(/[+/=]/);
  });

  it("rejects a checksum-damaged share", () => {
    const payload = formatShare(split(SECRET, 3, 2)[0], 2);
    // flip a character to a different valid base64url char
    const i = 5;
    const swapped =
      payload.slice(0, i) +
      (payload[i] === "A" ? "B" : "A") +
      payload.slice(i + 1);
    expect(parseShare(swapped)).toBeNull();
  });

  it("rejects a wrong version, junk, and truncated payloads", () => {
    expect(parseShare("!!!not base64!!!")).toBeNull();
    expect(parseShare("")).toBeNull();
    expect(parseShare("AAAA")).toBeNull(); // too short to hold a share
    // a valid-checksum blob with version 2
    const body = new Uint8Array([2, 2, 1, 9]); // version 2
    let sum = 0;
    for (const b of body) sum = (sum + b) & 0xff;
    const blob = new Uint8Array([...body, sum]);
    let bin = "";
    for (const b of blob) bin += String.fromCharCode(b);
    const payload = btoa(bin)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(parseShare(payload)).toBeNull();
  });
});
