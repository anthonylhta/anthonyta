import { describe, expect, it } from "vitest";
import {
  buildKeystore,
  deriveKek,
  fromB64url,
  generateMk,
  isKeystore,
  ITERATIONS,
  IV_LEN,
  open,
  randomId,
  randomSalt,
  SALT_LEN,
  seal,
  toB64url,
  unwrapMk,
  wrapMk,
  type EnvelopeMeta,
} from "./crypto";

// Tests run the real KDF but at a tiny iteration count — the production count is
// a tunable stored in the keystore, and 600k per test would dominate the suite.
const FAST = 1_000;

async function setupKeys(passphrase = "correct horse battery staple") {
  const salt = randomSalt();
  const kek = await deriveKek(passphrase, salt, FAST);
  const mkExtractable = await generateMk();
  const { wrapped, iv } = await wrapMk(mkExtractable, kek);
  const mk = await unwrapMk(wrapped, iv, kek);
  return { salt, kek, wrapped, iv, mk };
}

const META: EnvelopeMeta = { n: "secrets.txt", t: "text/plain", s: 11 };

describe("constants", () => {
  it("pins the production KDF/AEAD parameters", () => {
    expect(ITERATIONS).toBe(600_000);
    expect(IV_LEN).toBe(12);
    expect(SALT_LEN).toBe(16);
  });
});

describe("b64url helpers", () => {
  it("round-trips arbitrary bytes without padding chars", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(37));
    const s = toB64url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(fromB64url(s)).toEqual(bytes);
  });

  it("randomId is 22 chars of the blob-safe alphabet", () => {
    const id = randomId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomId()).not.toBe(id);
  });
});

describe("key hierarchy", () => {
  it("unwraps the same MK it wrapped (roundtrip through storage form)", async () => {
    const { mk } = await setupKeys();
    const bytes = new TextEncoder().encode("hello vault");
    const out = await open(mk, await seal(mk, META, bytes));
    expect(out.bytes).toEqual(bytes);
  });

  it("a wrong passphrase fails the unwrap — no verifier needed", async () => {
    const { salt, wrapped, iv } = await setupKeys("right");
    const badKek = await deriveKek("wrong", salt, FAST);
    await expect(unwrapMk(wrapped, iv, badKek)).rejects.toThrow();
  });

  it("the unwrapped MK is non-extractable", async () => {
    const { mk } = await setupKeys();
    expect(mk.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", mk)).rejects.toThrow();
  });

  it("passphrase change = re-wrap only; old data still opens", async () => {
    const { mk, kek: oldKek, wrapped, iv, salt } = await setupKeys("old-pass");
    const envelope = await seal(mk, META, new Uint8Array([1, 2, 3]));

    // The real flow: unwrap the MK momentarily extractable with the OLD KEK,
    // re-wrap under the NEW KEK, discard the extractable handle. The envelope
    // is never touched.
    const tempMk = await unwrapMk(wrapped, iv, oldKek, true);
    const newKek = await deriveKek("new-pass", salt, FAST);
    const { wrapped: w2, iv: iv2 } = await wrapMk(tempMk, newKek);

    const mkAgain = await unwrapMk(w2, iv2, newKek);
    expect(mkAgain.extractable).toBe(false);
    expect((await open(mkAgain, envelope)).bytes).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    // And the old passphrase no longer opens the new keystore entry.
    await expect(unwrapMk(w2, iv2, oldKek)).rejects.toThrow();
  });
});

describe("envelope seal/open", () => {
  it("round-trips bytes and meta exactly", async () => {
    const { mk } = await setupKeys();
    const bytes = crypto.getRandomValues(new Uint8Array(5000));
    const { meta, bytes: out } = await open(mk, await seal(mk, META, bytes));
    expect(out).toEqual(bytes);
    expect(meta).toEqual(META);
  });

  it("handles empty payloads and empty mime types", async () => {
    const { mk } = await setupKeys();
    const meta = { n: "empty", t: "", s: 0 };
    const out = await open(mk, await seal(mk, meta, new Uint8Array(0)));
    expect(out.bytes.length).toBe(0);
    expect(out.meta).toEqual(meta);
  });

  it("starts with the AEV1 magic in the clear", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new Uint8Array([9]));
    expect(new TextDecoder().decode(env.subarray(0, 4))).toBe("AEV1");
  });

  it("any flipped ciphertext byte fails the auth tag", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new TextEncoder().encode("tamper me"));
    const bent = new Uint8Array(env);
    bent[bent.length - 1] ^= 0x01;
    await expect(open(mk, bent)).rejects.toThrow();
  });

  it("a tampered MAGIC fails too — the version bytes ride as AAD", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new Uint8Array([1]));
    const bent = new Uint8Array(env);
    bent[0] = "B".charCodeAt(0);
    await expect(open(mk, bent)).rejects.toThrow(/magic/);
  });

  it("rejects truncated and garbage input cleanly", async () => {
    const { mk } = await setupKeys();
    await expect(open(mk, new Uint8Array(0))).rejects.toThrow(/truncated/);
    await expect(open(mk, new Uint8Array(10))).rejects.toThrow(/truncated/);
    const garbage = crypto.getRandomValues(new Uint8Array(64));
    await expect(open(mk, garbage)).rejects.toThrow();
  });

  it("an envelope sealed under one MK does not open under another", async () => {
    const a = await setupKeys("pass-a");
    const b = await setupKeys("pass-b");
    const env = await seal(a.mk, META, new Uint8Array([7]));
    await expect(open(b.mk, env)).rejects.toThrow();
  });

  it("two seals of the same plaintext differ (fresh IV per item)", async () => {
    const { mk } = await setupKeys();
    const bytes = new TextEncoder().encode("same input");
    const e1 = await seal(mk, META, bytes);
    const e2 = await seal(mk, META, bytes);
    expect(toB64url(e1)).not.toBe(toB64url(e2));
  });
});

describe("keystore", () => {
  it("builds a shape isKeystore accepts and JSON round-trips", async () => {
    const { salt, wrapped, iv } = await setupKeys();
    const ks = buildKeystore(salt, ITERATIONS, wrapped, iv);
    expect(isKeystore(ks)).toBe(true);
    const parsed: unknown = JSON.parse(JSON.stringify(ks));
    expect(isKeystore(parsed)).toBe(true);
    // Storage stays tiny — it's one wrapped key, not data.
    expect(JSON.stringify(ks).length).toBeLessThan(512);
  });

  it("the stored keystore actually unlocks: parse → derive → unwrap → open", async () => {
    const salt = randomSalt();
    const kek = await deriveKek("pass", salt, FAST);
    const mk0 = await generateMk();
    const { wrapped, iv } = await wrapMk(mk0, kek);
    const stored = JSON.stringify(buildKeystore(salt, FAST, wrapped, iv));

    const ks = JSON.parse(stored) as ReturnType<typeof buildKeystore>;
    const kek2 = await deriveKek("pass", fromB64url(ks.kdf.salt_b64), ks.kdf.iterations);
    const mk = await unwrapMk(
      fromB64url(ks.wrapped_mk_b64),
      fromB64url(ks.iv_b64),
      kek2,
    );
    const env = await seal(mk0, META, new Uint8Array([42]));
    expect((await open(mk, env)).bytes).toEqual(new Uint8Array([42]));
  });

  it("rejects malformed shapes", () => {
    expect(isKeystore(null)).toBe(false);
    expect(isKeystore("{}")).toBe(false);
    expect(isKeystore({})).toBe(false);
    expect(isKeystore({ v: 2 })).toBe(false);
    const { ...good } = {
      v: 1,
      kdf: { salt_b64: "abc", iterations: ITERATIONS },
      wrapped_mk_b64: "abc",
      iv_b64: "abc",
    };
    expect(isKeystore(good)).toBe(true);
    expect(isKeystore({ ...good, v: 0 })).toBe(false);
    expect(isKeystore({ ...good, wrapped_mk_b64: "" })).toBe(false);
    expect(isKeystore({ ...good, wrapped_mk_b64: "x".repeat(200) })).toBe(false);
    expect(isKeystore({ ...good, kdf: { salt_b64: "a", iterations: 10 } })).toBe(
      false, // sub-floor iteration counts are refused, not silently honored
    );
    expect(
      isKeystore({ ...good, kdf: { salt_b64: 1, iterations: ITERATIONS } }),
    ).toBe(false);
  });
});
