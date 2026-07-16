import { describe, expect, it } from "vitest";
import { argon2id } from "hash-wasm";
import { isArgonKdf, unwrapMk, wrapMk, generateMk } from "./crypto";
import {
  ARGON2_M,
  ARGON2_P,
  ARGON2_T,
  argon2Available,
  deriveKekArgon2,
  deriveKekForKdf,
  freshKdf,
} from "./kdf";

/**
 * Reference-implementation conformance vectors — argon2id v1.3 (0x13), 32-byte
 * output, transcribed from the phc-winner-argon2 test suite (test.c). These are
 * the load-bearing tests: they prove the vendored WASM computes Argon2id and
 * nothing else. Each was verified byte-for-byte against the published values
 * before being pinned here.
 */
const REFERENCE_VECTORS = [
  {
    t: 2,
    m: 65536,
    p: 1,
    pw: "password",
    salt: "somesalt",
    hex: "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7",
  },
  {
    t: 2,
    m: 262144,
    p: 1,
    pw: "password",
    salt: "somesalt",
    hex: "78fe1ec91fb3aa5657d72e710854e4c3d9b9198c742f9616c2f085bed95b2e8c",
  },
  {
    t: 2,
    m: 256,
    p: 1,
    pw: "password",
    salt: "somesalt",
    hex: "9dfeb910e80bad0311fee20f9c0e2b12c17987b4cac90c2ef54d5b3021c68bfe",
  },
  {
    t: 2,
    m: 256,
    p: 2,
    pw: "password",
    salt: "somesalt",
    hex: "6d093c501fd5999645e0ea3bf620d7b8be7fd2db59c20d9fff9539da2bf57037",
  },
];

describe("argon2id conformance (reference-implementation vectors)", () => {
  for (const v of REFERENCE_VECTORS) {
    it(`t=${v.t} m=${v.m} p=${v.p} matches the published output`, async () => {
      const hex = await argon2id({
        password: v.pw,
        salt: v.salt,
        iterations: v.t,
        memorySize: v.m,
        parallelism: v.p,
        hashLength: 32,
        outputType: "hex",
      });
      expect(hex).toBe(v.hex);
    });
  }

  it("a different passphrase or salt changes the output (sensitivity)", async () => {
    const base = REFERENCE_VECTORS[2]; // the cheap one
    const run = (pw: string, salt: string) =>
      argon2id({
        password: pw,
        salt,
        iterations: base.t,
        memorySize: base.m,
        parallelism: base.p,
        hashLength: 32,
        outputType: "hex",
      });
    expect(await run("Password", base.salt)).not.toBe(base.hex);
    expect(await run(base.pw, "somesalt2")).not.toBe(base.hex);
  });
});

describe("deriveKekArgon2 / deriveKekForKdf", () => {
  const salt = new Uint8Array(16).fill(7);
  const cheap = { m: 256, t: 2, p: 1 };

  it("derives a working wrap/unwrap KEK — round-trips a master key", async () => {
    const kek = await deriveKekArgon2("open sesame", salt, cheap);
    const mk = await generateMk();
    const { wrapped, iv } = await wrapMk(mk, kek);
    await expect(unwrapMk(wrapped, iv, kek)).resolves.toBeDefined();
  });

  it("a wrong passphrase fails the unwrap's GCM check — that throw IS the verdict", async () => {
    const kek = await deriveKekArgon2("open sesame", salt, cheap);
    const mk = await generateMk();
    const { wrapped, iv } = await wrapMk(mk, kek);
    const wrong = await deriveKekArgon2("open sesame!", salt, cheap);
    await expect(unwrapMk(wrapped, iv, wrong)).rejects.toThrow();
  });

  it("dispatches on the kdf block: argon2id and pbkdf2 both round-trip", async () => {
    for (const kdf of [
      {
        algo: "argon2id" as const,
        salt_b64: "BwcHBwcHBwcHBwcHBwcHBw",
        ...cheap,
      },
      { salt_b64: "BwcHBwcHBwcHBwcHBwcHBw", iterations: 100_000 },
    ]) {
      const kek = await deriveKekForKdf(kdf, "pass");
      const mk = await generateMk();
      const { wrapped, iv } = await wrapMk(mk, kek);
      await expect(unwrapMk(wrapped, iv, kek)).resolves.toBeDefined();
    }
  });
});

describe("argon2Available / freshKdf", () => {
  it("reports available in this environment (Node runs the same WASM CI does)", async () => {
    expect(await argon2Available()).toBe(true);
  });

  it("mints an argon2id block with the interactive profile and a fresh salt", async () => {
    const a = await freshKdf();
    const b = await freshKdf();
    expect(isArgonKdf(a)).toBe(true);
    if (isArgonKdf(a) && isArgonKdf(b)) {
      expect(a.m).toBe(ARGON2_M);
      expect(a.t).toBe(ARGON2_T);
      expect(a.p).toBe(ARGON2_P);
      expect(a.salt_b64).not.toBe(b.salt_b64); // never a reused salt
    }
  });
});
