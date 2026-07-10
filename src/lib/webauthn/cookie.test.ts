import { describe, expect, it } from "vitest";
import {
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_S,
  challengeClearCookie,
  challengeFromCookieHeader,
  challengeSetCookie,
  openChallenge,
  sealChallenge,
} from "./cookie";

const SECRET = "test-secret";
const NOW = 1_750_000_000_000;

describe("sealChallenge / openChallenge", () => {
  it("round-trips a challenge of the same type", () => {
    const sealed = sealChallenge("chal-abc123", "auth", SECRET, NOW);
    expect(openChallenge(sealed, "auth", SECRET, NOW)).toBe("chal-abc123");
  });

  it("rejects the wrong ceremony type", () => {
    const sealed = sealChallenge("chal-abc123", "reg", SECRET, NOW);
    expect(openChallenge(sealed, "auth", SECRET, NOW)).toBeNull();
  });

  it("expires exactly at the TTL boundary", () => {
    const sealed = sealChallenge("c", "auth", SECRET, NOW);
    const justBefore = NOW + (CHALLENGE_TTL_S - 1) * 1000;
    const atExpiry = NOW + CHALLENGE_TTL_S * 1000;
    expect(openChallenge(sealed, "auth", SECRET, justBefore)).toBe("c");
    expect(openChallenge(sealed, "auth", SECRET, atExpiry)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const sealed = sealChallenge("c", "auth", SECRET, NOW);
    const [payload, sig] = sealed.split(".");
    const flipped = (payload[0] === "A" ? "B" : "A") + payload.slice(1);
    expect(openChallenge(`${flipped}.${sig}`, "auth", SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered or truncated signature", () => {
    const sealed = sealChallenge("c", "auth", SECRET, NOW);
    const [payload, sig] = sealed.split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(
      openChallenge(`${payload}.${flipped}`, "auth", SECRET, NOW),
    ).toBeNull();
    expect(
      openChallenge(`${payload}.${sig.slice(0, 10)}`, "auth", SECRET, NOW),
    ).toBeNull();
  });

  it("rejects the wrong secret", () => {
    const sealed = sealChallenge("c", "auth", SECRET, NOW);
    expect(openChallenge(sealed, "auth", "other-secret", NOW)).toBeNull();
  });

  it("rejects malformed values", () => {
    for (const v of ["", "no-dot", "a.b.c", ".", "x.", ".y"]) {
      expect(openChallenge(v, "auth", SECRET, NOW)).toBeNull();
    }
  });
});

describe("cookie strings", () => {
  it("sets the hardened attributes", () => {
    const set = challengeSetCookie("value", false);
    expect(set).toContain(`${CHALLENGE_COOKIE}=value`);
    expect(set).toContain(`Max-Age=${CHALLENGE_TTL_S}`);
    expect(set).toContain("Path=/api/auth");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    expect(set).not.toContain("Secure");
    expect(challengeSetCookie("value", true)).toContain("; Secure");
  });

  it("clears with Max-Age=0", () => {
    const clear = challengeClearCookie(true);
    expect(clear).toContain(`${CHALLENGE_COOKIE}=;`);
    expect(clear).toContain("Max-Age=0");
    expect(clear).toContain("Secure");
  });
});

describe("challengeFromCookieHeader", () => {
  it("finds the cookie among others", () => {
    const header = `a=1; ${CHALLENGE_COOKIE}=sealed.value; b=2`;
    expect(challengeFromCookieHeader(header)).toBe("sealed.value");
  });

  it("handles absence and emptiness", () => {
    expect(challengeFromCookieHeader(null)).toBeNull();
    expect(challengeFromCookieHeader("a=1; b=2")).toBeNull();
    expect(challengeFromCookieHeader(`${CHALLENGE_COOKIE}=`)).toBeNull();
  });

  it("does not match a prefix-named cookie", () => {
    expect(challengeFromCookieHeader(`${CHALLENGE_COOKIE}-other=x`)).toBeNull();
  });
});
