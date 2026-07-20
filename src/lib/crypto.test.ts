import { describe, expect, it } from "vitest";
import {
  BOX_MAGIC,
  BOX_PUB_LEN,
  boxOpen,
  boxSeal,
  buildKeystore,
  checkCanary,
  deriveKek,
  exportKeyRaw,
  fromB64url,
  generateBoxKeypair,
  generateMk,
  generateShareKey,
  hasAevMagic,
  importBoxPriv,
  importShareKey,
  isKeystore,
  ITERATIONS,
  IV_LEN,
  MAGIC_V2,
  open,
  randomId,
  randomSalt,
  SALT_LEN,
  seal,
  sealCanary,
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

describe("envelope context binding (AEV2)", () => {
  const PATH = "vault/note-A.bin";

  it("round-trips meta and bytes under the right path", async () => {
    const { mk } = await setupKeys();
    const bytes = crypto.getRandomValues(new Uint8Array(3000));
    const env = await seal(mk, META, bytes, PATH);
    const { meta, bytes: out } = await open(mk, env, PATH);
    expect(out).toEqual(bytes);
    expect(meta).toEqual(META);
  });

  it("a context makes an AEV2 envelope; its absence stays AEV1", async () => {
    const { mk } = await setupKeys();
    const v1 = await seal(mk, META, new Uint8Array([1]));
    const v2 = await seal(mk, META, new Uint8Array([1]), PATH);
    expect(new TextDecoder().decode(v1.subarray(0, 4))).toBe("AEV1");
    expect(new TextDecoder().decode(v2.subarray(0, 4))).toBe(MAGIC_V2);
    expect(MAGIC_V2).toBe("AEV2");
  });

  // The fixed-config PUT routes frame-check with `hasAevMagic`. It MUST accept a
  // context-sealed (AEV2) envelope — the regression: the routes only knew AEV1, so
  // every write from a context-sealing client (fin/transit/todo/totp) 404'd.
  it("hasAevMagic accepts what a context-seal emits (AEV1 and AEV2)", async () => {
    const { mk } = await setupKeys();
    const v1 = await seal(mk, META, new Uint8Array([1]));
    const v2 = await seal(mk, META, new Uint8Array([1]), "meta/todo");
    expect(hasAevMagic(v1)).toBe(true);
    expect(hasAevMagic(v2)).toBe(true);
    expect(hasAevMagic(new TextEncoder().encode("XXXXnot an envelope"))).toBe(
      false,
    );
    expect(hasAevMagic(new Uint8Array([0x41, 0x45, 0x56]))).toBe(false); // "AEV" only
  });

  it("THE SWAP TEST: sealed at path A, refuses to open as path B", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new Uint8Array([7]), "vault/note-A.bin");
    await expect(open(mk, env, "vault/note-B.bin")).rejects.toThrow();
  });

  it("cross-purpose refusal: a vault blob cannot open as meta/fin", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new Uint8Array([7]), "vault/x.bin");
    await expect(open(mk, env, "meta/fin")).rejects.toThrow();
  });

  it("a v2 envelope opened without a path throws before any crypto", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new Uint8Array([7]), PATH);
    await expect(open(mk, env)).rejects.toThrow(/storage path/);
  });

  it("a v1 envelope opens with AND without a context (context ignored)", async () => {
    const { mk } = await setupKeys();
    const bytes = new TextEncoder().encode("legacy blob");
    const env = await seal(mk, META, bytes); // no context → AEV1
    expect((await open(mk, env)).bytes).toEqual(bytes);
    // A v1 blob predates contexts; a supplied path must not break it.
    const { meta, bytes: out } = await open(mk, env, "any/path/at/all");
    expect(out).toEqual(bytes);
    expect(meta).toEqual(META);
  });

  it("the empty string is a real context, distinct from no context", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new Uint8Array([9]), "");
    // "" seals a v2 envelope (explicit is explicit)…
    expect(new TextDecoder().decode(env.subarray(0, 4))).toBe(MAGIC_V2);
    // …so it opens only under "" — not under a missing path, not under another one.
    expect((await open(mk, env, "")).bytes).toEqual(new Uint8Array([9]));
    await expect(open(mk, env)).rejects.toThrow(/storage path/);
    await expect(open(mk, env, "x")).rejects.toThrow();
  });

  it("length-boundary injectivity: (meta, path) pairs that naively collide stay apart", async () => {
    const { mk } = await setupKeys();
    // A naive `name‖path` AAD would fuse these two pairs — both spell "abcd/e.bin":
    //   {n:"ab"} + "cd/e.bin"  ===  {n:"a"} + "bcd/e.bin"
    // AEV2 keeps them apart: the path is the sole AAD field (domain-separated), and
    // the name is bound through the encrypted payload, never concatenated with it.
    const metaA = { n: "ab", t: "text/plain", s: 2 };
    const pathA = "cd/e.bin";
    const metaB = { n: "a", t: "text/plain", s: 1 };
    const pathB = "bcd/e.bin";
    expect(metaA.n + pathA).toBe(metaB.n + pathB); // the naive collision, made explicit

    const envA = await seal(mk, metaA, new Uint8Array([1]), pathA);
    const envB = await seal(mk, metaB, new Uint8Array([2]), pathB);

    expect((await open(mk, envA, pathA)).meta).toEqual(metaA);
    expect((await open(mk, envB, pathB)).meta).toEqual(metaB);
    // Each opens ONLY under its own pair — swapping paths fails the tag.
    await expect(open(mk, envA, pathB)).rejects.toThrow();
    await expect(open(mk, envB, pathA)).rejects.toThrow();
  });

  it("v2 tamper: any flipped ciphertext byte fails the auth tag", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new TextEncoder().encode("tamper"), PATH);
    const bent = new Uint8Array(env);
    bent[bent.length - 1] ^= 0x01;
    await expect(open(mk, bent, PATH)).rejects.toThrow();
  });

  it("v2 truncation and a tampered magic reject cleanly", async () => {
    const { mk } = await setupKeys();
    const env = await seal(mk, META, new Uint8Array([1]), PATH);
    await expect(open(mk, env.subarray(0, 20), PATH)).rejects.toThrow(
      /truncated/,
    );
    const bent = new Uint8Array(env);
    bent[3] = "9".charCodeAt(0); // "AEV2" → "AEV9": neither magic
    await expect(open(mk, bent, PATH)).rejects.toThrow(/magic/);
  });

  it("a v2 envelope does not open under a different MK", async () => {
    const a = await setupKeys("pass-a");
    const b = await setupKeys("pass-b");
    const env = await seal(a.mk, META, new Uint8Array([7]), PATH);
    await expect(open(b.mk, env, PATH)).rejects.toThrow();
  });

  it("version confusion fails: a flipped magic can't cross v1/v2", async () => {
    const { mk } = await setupKeys();
    // v1 blob relabelled as v2: the tag was over aad "AEV1", not "aev2\0<path>".
    const v1 = await seal(mk, META, new Uint8Array([1]));
    const asV2 = new Uint8Array(v1);
    asV2.set(new TextEncoder().encode("AEV2"), 0);
    await expect(open(mk, asV2, PATH)).rejects.toThrow();
    // v2 blob relabelled as v1: now open ignores the path and authenticates "AEV1".
    const v2 = await seal(mk, META, new Uint8Array([1]), PATH);
    const asV1 = new Uint8Array(v2);
    asV1.set(new TextEncoder().encode("AEV1"), 0);
    await expect(open(mk, asV1)).rejects.toThrow();
  });
});

/** A pbkdf2 kdf block for the new buildKeystore signature (tests stay on the
 *  legacy KDF — lib/kdf's own suite covers argon2id blocks). */
const pbkdf = (salt: Uint8Array, iterations: number) => ({
  salt_b64: toB64url(salt),
  iterations,
});

describe("keystore", () => {
  it("builds a shape isKeystore accepts and JSON round-trips", async () => {
    const { salt, wrapped, iv } = await setupKeys();
    const ks = buildKeystore(pbkdf(salt, ITERATIONS), wrapped, iv);
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
    const stored = JSON.stringify(
      buildKeystore(pbkdf(salt, FAST), wrapped, iv),
    );

    const ks = JSON.parse(stored) as ReturnType<typeof buildKeystore>;
    const kek2 = await deriveKek("pass", fromB64url(ks.kdf.salt_b64), FAST);
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
    expect(isKeystore({ ...good, wrapped_mk_b64: "x".repeat(200) })).toBe(
      false,
    );
    expect(
      isKeystore({ ...good, kdf: { salt_b64: "a", iterations: 10 } }),
    ).toBe(
      false, // sub-floor iteration counts are refused, not silently honored
    );
    expect(
      isKeystore({ ...good, kdf: { salt_b64: 1, iterations: ITERATIONS } }),
    ).toBe(false);
  });

  it("isKeystore accepts either kdf shape and rejects hybrids/bad params", () => {
    const base = {
      v: 1,
      wrapped_mk_b64: "abc",
      iv_b64: "abc",
    };
    const argon = { algo: "argon2id", salt_b64: "abc", m: 65536, t: 3, p: 1 };
    expect(isKeystore({ ...base, kdf: argon })).toBe(true);
    // A half-and-half hybrid (argon algo + pbkdf2 iterations) is malformed.
    expect(
      isKeystore({ ...base, kdf: { ...argon, iterations: 600_000 } }),
    ).toBe(false);
    // Sub-floor memory would smuggle in a cheap-to-crack keystore (downgrade).
    expect(isKeystore({ ...base, kdf: { ...argon, m: 1024 } })).toBe(false);
    // Ceilings keep a hostile keystore from OOMing/stalling the unlock.
    expect(isKeystore({ ...base, kdf: { ...argon, m: 2_097_152 } })).toBe(
      false,
    );
    expect(isKeystore({ ...base, kdf: { ...argon, t: 0 } })).toBe(false);
    expect(isKeystore({ ...base, kdf: { ...argon, t: 99 } })).toBe(false);
    expect(isKeystore({ ...base, kdf: { ...argon, p: 0 } })).toBe(false);
    expect(isKeystore({ ...base, kdf: { ...argon, p: 8 } })).toBe(false);
    // An unknown algo is rejected, not silently treated as pbkdf2.
    expect(
      isKeystore({
        ...base,
        kdf: { algo: "scrypt", salt_b64: "abc", m: 65536, t: 3, p: 1 },
      }),
    ).toBe(false);
  });

  it("isKeystore accepts v1 and v2, gating on the canary field", () => {
    const v1 = {
      v: 1,
      kdf: { salt_b64: "abc", iterations: ITERATIONS },
      wrapped_mk_b64: "abc",
      iv_b64: "abc",
    };
    expect(isKeystore(v1)).toBe(true);
    // v2 REQUIRES a sealed canary…
    expect(isKeystore({ ...v1, v: 2 })).toBe(false);
    expect(isKeystore({ ...v1, v: 2, canary_b64: "Y2FuYXJ5" })).toBe(true);
    expect(isKeystore({ ...v1, v: 2, canary_b64: "" })).toBe(false);
    expect(isKeystore({ ...v1, v: 2, canary_b64: "x".repeat(300) })).toBe(
      false,
    );
    expect(isKeystore({ ...v1, v: 2, canary_b64: 123 })).toBe(false);
    // …and v1 must NOT carry one — the field is exactly what the version gates.
    expect(isKeystore({ ...v1, canary_b64: "Y2FuYXJ5" })).toBe(false);
  });
});

describe("keystore canary", () => {
  it("buildKeystore with a canary is a v2 keystore isKeystore accepts", async () => {
    const { mk, salt, wrapped, iv } = await setupKeys();
    // ITERATIONS (not FAST) so the stored count clears isKeystore's KDF floor.
    const ks = buildKeystore(
      pbkdf(salt, ITERATIONS),
      wrapped,
      iv,
      await sealCanary(mk),
    );
    expect(ks.v).toBe(2);
    expect(typeof ks.canary_b64).toBe("string");
    expect(isKeystore(ks)).toBe(true);
    // Survives the JSON round-trip the store puts it through.
    expect(isKeystore(JSON.parse(JSON.stringify(ks)))).toBe(true);
  });

  it("the sealing MK opens its canary; any other MK fails", async () => {
    const a = await setupKeys("pass-a");
    const b = await setupKeys("pass-b");
    const ks = buildKeystore(
      pbkdf(a.salt, FAST),
      a.wrapped,
      a.iv,
      await sealCanary(a.mk),
    );
    expect(await checkCanary(a.mk, ks)).toBe(true);
    expect(await checkCanary(b.mk, ks)).toBe(false);
  });

  it("a v1 keystore has no canary — checkCanary returns 'absent' and skips", async () => {
    const { mk, salt, wrapped, iv } = await setupKeys();
    const v1 = buildKeystore(pbkdf(salt, FAST), wrapped, iv); // no canary arg → v1
    expect(v1.v).toBe(1);
    expect(await checkCanary(mk, v1)).toBe("absent");
  });

  it("survives a passphrase change: the canary is under the MK, not the KEK", async () => {
    const { mk, kek: oldKek, wrapped, iv, salt } = await setupKeys("old-pass");
    const canary = await sealCanary(mk);
    const ksOld = buildKeystore(pbkdf(salt, FAST), wrapped, iv, canary);
    expect(await checkCanary(mk, ksOld)).toBe(true);

    // Passphrase change re-wraps the SAME MK under a new KEK; the canary rides
    // along untouched (or re-sealed under the same key — either stays valid).
    const tempMk = await unwrapMk(wrapped, iv, oldKek, true);
    const newKek = await deriveKek("new-pass", salt, FAST);
    const { wrapped: w2, iv: iv2 } = await wrapMk(tempMk, newKek);
    const ksNew = buildKeystore(pbkdf(salt, FAST), w2, iv2, canary);

    // The MK unwrapped from the NEW keystore still opens the canary.
    const mkAgain = await unwrapMk(w2, iv2, newKek);
    expect(await checkCanary(mkAgain, ksNew)).toBe(true);
    expect(await checkCanary(mkAgain, ksOld)).toBe(true); // same MK, either store
  });

  it("a reset (fresh MK) invalidates the canary — the stale-key case", async () => {
    const a = await setupKeys("pass");
    const ks = buildKeystore(
      pbkdf(a.salt, FAST),
      a.wrapped,
      a.iv,
      await sealCanary(a.mk),
    );
    expect(await checkCanary(a.mk, ks)).toBe(true);
    // Another device reset the vault: a brand-new random MK under the same
    // passphrase. The old cached key can no longer open the new keystore's canary.
    const b = await setupKeys("pass");
    expect(await checkCanary(b.mk, ks)).toBe(false);
  });

  it("a tampered or truncated canary reads as false, never throws", async () => {
    const { mk, salt, wrapped, iv } = await setupKeys();
    const bytes = fromB64url(await sealCanary(mk));
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = buildKeystore(
      pbkdf(salt, FAST),
      wrapped,
      iv,
      toB64url(bytes),
    );
    expect(await checkCanary(mk, tampered)).toBe(false);
    const truncated = buildKeystore(
      pbkdf(salt, FAST),
      wrapped,
      iv,
      toB64url(bytes.subarray(0, 8)),
    );
    expect(await checkCanary(mk, truncated)).toBe(false);
  });
});

describe("share keys", () => {
  it("generate → export → import round-trips through seal/open", async () => {
    const key = await generateShareKey();
    const bytes = crypto.getRandomValues(new Uint8Array(2048));
    const envelope = await seal(key, META, bytes);

    // The recipient rebuilds the key from only the 32 raw fragment bytes.
    const raw = await exportKeyRaw(key);
    const imported = await importShareKey(raw);
    const { meta, bytes: out } = await open(imported, envelope);
    expect(out).toEqual(bytes);
    expect(meta).toEqual(META);
  });

  it("a different imported key cannot open the envelope", async () => {
    const key = await generateShareKey();
    const envelope = await seal(key, META, new Uint8Array([1, 2, 3]));
    const other = await importShareKey(
      await exportKeyRaw(await generateShareKey()),
    );
    await expect(open(other, envelope)).rejects.toThrow();
  });

  it("exportKeyRaw yields the 32 bytes of an AES-256 key", async () => {
    expect((await exportKeyRaw(await generateShareKey())).length).toBe(32);
  });

  it("an imported share key is decrypt-only and non-extractable", async () => {
    const imported = await importShareKey(
      await exportKeyRaw(await generateShareKey()),
    );
    expect(imported.extractable).toBe(false);
    expect(imported.usages).toEqual(["decrypt"]);
    await expect(crypto.subtle.exportKey("raw", imported)).rejects.toThrow();
  });
});

describe("sealed box (ASB1)", () => {
  it("pins the box constants", () => {
    expect(BOX_MAGIC).toBe("ASB1");
    expect(BOX_PUB_LEN).toBe(65);
  });

  it("seals to a public key so only the private half can open it", async () => {
    const { pubRaw, privPkcs8 } = await generateBoxKeypair();
    const msg = new TextEncoder().encode("a stranger's private note");
    // The sender holds ONLY the public point.
    const box = await boxSeal(pubRaw, msg);
    const priv = await importBoxPriv(privPkcs8);
    expect(await boxOpen(priv, pubRaw, box)).toEqual(msg);
  });

  it("a different recipient's key cannot open the box", async () => {
    const a = await generateBoxKeypair();
    const b = await generateBoxKeypair();
    const box = await boxSeal(a.pubRaw, new Uint8Array([1, 2, 3]));
    const bPriv = await importBoxPriv(b.privPkcs8);
    await expect(boxOpen(bPriv, b.pubRaw, box)).rejects.toThrow();
  });

  it("the same plaintext yields a different envelope every time (fresh ephemeral)", async () => {
    const { pubRaw } = await generateBoxKeypair();
    const msg = new Uint8Array([9, 9, 9]);
    const one = await boxSeal(pubRaw, msg);
    const two = await boxSeal(pubRaw, msg);
    expect(toB64url(one)).not.toBe(toB64url(two));
  });

  it("carries the magic + ephemeral point in the framing", async () => {
    const { pubRaw } = await generateBoxKeypair();
    const box = await boxSeal(pubRaw, new Uint8Array([0]));
    expect(new TextDecoder().decode(box.subarray(0, 4))).toBe("ASB1");
    expect(box.length).toBeGreaterThanOrEqual(4 + 65 + 12 + 16);
  });

  it("rejects a truncated envelope, bad magic, and a tampered body", async () => {
    const { pubRaw, privPkcs8 } = await generateBoxKeypair();
    const priv = await importBoxPriv(privPkcs8);
    const box = await boxSeal(pubRaw, new Uint8Array([1, 2, 3, 4]));

    await expect(boxOpen(priv, pubRaw, box.subarray(0, 20))).rejects.toThrow(
      "truncated",
    );
    const badMagic = box.slice();
    badMagic[0] ^= 0xff;
    await expect(boxOpen(priv, pubRaw, badMagic)).rejects.toThrow("bad magic");
    const tampered = box.slice();
    tampered[tampered.length - 1] ^= 0xff;
    await expect(boxOpen(priv, pubRaw, tampered)).rejects.toThrow();
  });

  it("an imported box private key is non-extractable", async () => {
    const { privPkcs8 } = await generateBoxKeypair();
    const priv = await importBoxPriv(privPkcs8);
    expect(priv.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", priv)).rejects.toThrow();
  });
});
