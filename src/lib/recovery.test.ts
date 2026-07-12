import { describe, expect, it } from "vitest";
import { reconstructSecret } from "./recovery";
import { formatShare, split } from "./shamir";

const SECRET = new TextEncoder().encode("correct horse battery staple!!!!"); // 32B

/** The printed payloads for the first `count` of an n/k split. */
function payloads(n: number, k: number, count = k): string[] {
  return split(SECRET, n, k)
    .slice(0, count)
    .map((s) => formatShare(s, k));
}

describe("reconstructSecret", () => {
  it("reconstructs from exactly the threshold of correct shares", () => {
    const res = reconstructSecret(payloads(5, 3));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.secret).toEqual(SECRET);
      expect(res.threshold).toBe(3);
      expect(res.used).toBe(3);
    }
  });

  it("reconstructs when more than the threshold is pasted", () => {
    const res = reconstructSecret(payloads(5, 3, 5));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.secret).toEqual(SECRET);
  });

  it("ignores blank lines (a textarea split on newlines)", () => {
    const [a, b, c] = payloads(5, 3);
    const res = reconstructSecret(["", a, "  ", b, c, ""]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.secret).toEqual(SECRET);
  });

  it("names the damaged share by position", () => {
    const [a, b] = payloads(5, 3);
    // corrupt the second share's checksum by flipping a payload char
    const bad = "AAAA" + b.slice(4);
    const res = reconstructSecret([a, bad, "irrelevant"]);
    expect(res).toEqual({ ok: false, error: "share 2 looks damaged" });
  });

  it("rejects junk and empty input", () => {
    expect(reconstructSecret([])).toEqual({
      ok: false,
      error: "paste at least one share",
    });
    expect(reconstructSecret(["   ", ""])).toEqual({
      ok: false,
      error: "paste at least one share",
    });
    expect(reconstructSecret(["!!!not base64!!!"])).toEqual({
      ok: false,
      error: "share 1 looks damaged",
    });
  });

  it("rejects too few shares for the threshold", () => {
    const res = reconstructSecret(payloads(5, 3, 2));
    expect(res).toEqual({
      ok: false,
      error: "need 3 shares to recover — have 2",
    });
  });

  it("rejects shares from different splits (mismatched threshold)", () => {
    const a = formatShare(split(SECRET, 5, 3)[0], 3);
    const b = formatShare(split(SECRET, 5, 2)[0], 2);
    expect(reconstructSecret([a, b])).toEqual({
      ok: false,
      error: "shares are from different splits",
    });
  });

  it("rejects a duplicated share", () => {
    const [a] = payloads(5, 3);
    expect(reconstructSecret([a, a])).toEqual({
      ok: false,
      error: "share 2 is a duplicate",
    });
  });

  it("returns a WRONG secret silently for wrong-but-valid shares (why the envelope check exists)", () => {
    // Two independent 3-of-5 splits of the SAME secret: mixing one share from each
    // yields valid-checksum shares that interpolate to garbage, not the secret.
    const one = split(SECRET, 5, 3).map((s) => formatShare(s, 3));
    const two = split(SECRET, 5, 3).map((s) => formatShare(s, 3));
    const res = reconstructSecret([one[0], one[1], two[2]]);
    // It parses and combines without complaint — and does NOT equal the secret.
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.secret).not.toEqual(SECRET);
  });
});
