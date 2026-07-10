import { describe, expect, it } from "vitest";
import {
  hashRecoveryCode,
  matchesRecoveryHash,
  mintRecoveryCode,
} from "./recovery";

describe("recovery code", () => {
  it("mints unique high-entropy base64url codes", () => {
    const a = mintRecoveryCode();
    const b = mintRecoveryCode();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 bytes → 22 b64url chars
  });

  it("round-trips mint → hash → match", () => {
    const code = mintRecoveryCode();
    const hash = hashRecoveryCode(code);
    expect(matchesRecoveryHash(code, hash)).toBe(true);
  });

  it("rejects the wrong code and a tampered hash", () => {
    const code = mintRecoveryCode();
    const hash = hashRecoveryCode(code);
    expect(matchesRecoveryHash("not-the-code", hash)).toBe(false);
    expect(matchesRecoveryHash(code, hashRecoveryCode("other"))).toBe(false);
  });
});
