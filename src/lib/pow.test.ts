import { describe, expect, it } from "vitest";
import { leadingZeroBits, solve, verify } from "./pow";

// A low difficulty keeps the suite fast; the shipped POW_BITS is exercised for real
// only in the browser. The math is difficulty-independent.
const BITS = 10;
const prefix = new TextEncoder().encode("some ciphertext bytes");

describe("leadingZeroBits", () => {
  it("counts full zero bytes and the partial byte above the first set bit", () => {
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x40]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(leadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x10]))).toBe(19);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16);
  });
});

describe("solve / verify", () => {
  it("solve finds a nonce that verify accepts at the same difficulty", async () => {
    const nonce = await solve(prefix, BITS);
    expect(Number.isSafeInteger(nonce)).toBe(true);
    expect(await verify(prefix, nonce, BITS)).toBe(true);
  });
  it("is deterministic — solve returns the FIRST valid nonce", async () => {
    expect(await solve(prefix, BITS)).toBe(await solve(prefix, BITS));
  });
  it("a solution is bound to its exact prefix", async () => {
    const nonce = await solve(prefix, BITS);
    const other = new TextEncoder().encode("some ciphertext byteS"); // one bit off
    expect(await verify(other, nonce, BITS)).toBe(false);
  });
  it("verify rejects a non-solution and malformed nonces", async () => {
    // 0 is overwhelmingly unlikely to clear 10 bits for this prefix.
    expect(await verify(prefix, 0, BITS)).toBe(false);
    expect(await verify(prefix, -1, BITS)).toBe(false);
    expect(await verify(prefix, 1.5, BITS)).toBe(false);
  });
  it("a higher difficulty is a superset — a harder solution still clears an easier bar", async () => {
    const nonce = await solve(prefix, BITS + 4);
    expect(await verify(prefix, nonce, BITS)).toBe(true);
  });
  it("solve aborts when signalled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(solve(prefix, 30, ctrl.signal)).rejects.toThrow("aborted");
  });
});
