import { describe, expect, it } from "vitest";
import { generateMk, unwrapMk, wrapMk } from "./crypto";
import {
  deriveKekFromPrf,
  findWrap,
  isPrfWrap,
  isPrfWrapSet,
  PRF_SALT,
  removeWrap,
  upsertWrap,
  type PrfWrap,
  type PrfWrapSet,
} from "./prf";

const secret = () => crypto.getRandomValues(new Uint8Array(32));

describe("PRF_SALT", () => {
  it("is a stable 32-byte domain-separated salt", () => {
    expect(PRF_SALT.length).toBe(32);
    // stable across reads (same reference bytes)
    expect(new TextDecoder().decode(PRF_SALT)).toContain(
      "anthonyta.dev/vault/prf",
    );
  });
});

describe("deriveKekFromPrf", () => {
  it("wraps and unwraps the master key through the passkey-derived KEK", async () => {
    const prf = secret();
    const mk = await generateMk();
    const kek = await deriveKekFromPrf(prf);
    const { wrapped, iv } = await wrapMk(mk, kek);
    // A KEK derived AGAIN from the same PRF secret unwraps it — determinism is
    // what lets the same passkey re-open the vault every sign-in.
    const kek2 = await deriveKekFromPrf(prf);
    const mkAgain = await unwrapMk(wrapped, iv, kek2);
    expect(mkAgain.extractable).toBe(false);
    // prove it's really the same key: wrap-unwrap chain produced a usable MK
    const data = new TextEncoder().encode("secret");
    const enc = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(12) },
      await unwrapMk(wrapped, iv, await deriveKekFromPrf(prf)),
      data,
    );
    const dec = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(12) },
      mkAgain,
      enc,
    );
    expect(new Uint8Array(dec)).toEqual(data);
  });

  it("a different PRF secret derives a KEK that cannot unwrap", async () => {
    const mk = await generateMk();
    const { wrapped, iv } = await wrapMk(mk, await deriveKekFromPrf(secret()));
    await expect(
      unwrapMk(wrapped, iv, await deriveKekFromPrf(secret())),
    ).rejects.toThrow();
  });

  it("rejects a too-short PRF secret", async () => {
    await expect(deriveKekFromPrf(new Uint8Array(16))).rejects.toThrow(
      /at least 32/,
    );
  });

  it("the derived KEK is non-extractable and wrap-only", async () => {
    const kek = await deriveKekFromPrf(secret());
    expect(kek.extractable).toBe(false);
    expect(kek.usages.sort()).toEqual(["unwrapKey", "wrapKey"]);
  });
});

const wrap = (id: string): PrfWrap => ({
  v: 1,
  credential_id_b64: id,
  wrapped_mk_b64: "AAAA",
  iv_b64: "BBBB",
});

describe("isPrfWrap / isPrfWrapSet", () => {
  it("accepts well-formed wraps and sets, with or without a label", () => {
    expect(isPrfWrap(wrap("cred1"))).toBe(true); // label absent — backward compatible
    expect(isPrfWrap({ ...wrap("cred1"), label: "android" })).toBe(true);
    expect(isPrfWrapSet({ v: 1, wraps: [wrap("a"), wrap("b")] })).toBe(true);
    expect(isPrfWrapSet({ v: 1, wraps: [] })).toBe(true);
  });
  it("rejects malformed wraps", () => {
    expect(isPrfWrap({ ...wrap("a"), v: 2 })).toBe(false);
    expect(isPrfWrap({ ...wrap("a"), credential_id_b64: "" })).toBe(false);
    expect(isPrfWrap({ ...wrap("a"), wrapped_mk_b64: "x".repeat(129) })).toBe(
      false,
    );
    expect(isPrfWrap({ ...wrap("a"), label: 5 })).toBe(false); // non-string label
    expect(isPrfWrap({ ...wrap("a"), label: "x".repeat(65) })).toBe(false); // too long
    expect(isPrfWrap(null)).toBe(false);
  });
  it("rejects duplicate credentials and oversized sets", () => {
    expect(isPrfWrapSet({ v: 1, wraps: [wrap("a"), wrap("a")] })).toBe(false);
    const many = Array.from({ length: 13 }, (_, i) => wrap(`c${i}`));
    expect(isPrfWrapSet({ v: 1, wraps: many })).toBe(false);
  });
});

describe("upsertWrap / removeWrap / findWrap", () => {
  const base: PrfWrapSet = { v: 1, wraps: [wrap("a"), wrap("b")] };

  it("adds a new device's wrap without disturbing the others", () => {
    const out = upsertWrap(base, wrap("c"));
    expect(out.wraps.map((w) => w.credential_id_b64).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(base.wraps).toHaveLength(2); // input untouched
  });
  it("replaces a same-credential wrap in place (re-enroll on a device)", () => {
    const replacement = { ...wrap("a"), wrapped_mk_b64: "ZZZZ" };
    const out = upsertWrap(base, replacement);
    expect(out.wraps).toHaveLength(2);
    expect(findWrap(out, "a")?.wrapped_mk_b64).toBe("ZZZZ");
  });
  it("removes a lost/rotated device's wrap", () => {
    const out = removeWrap(base, "a");
    expect(out.wraps.map((w) => w.credential_id_b64)).toEqual(["b"]);
    expect(isPrfWrapSet(out)).toBe(true);
  });
  it("findWrap returns null for an unknown credential", () => {
    expect(findWrap(base, "nope")).toBeNull();
  });
});
