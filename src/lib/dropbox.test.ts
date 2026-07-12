import { describe, expect, it } from "vitest";
import {
  buildMessage,
  dropPath,
  isDropboxKey,
  isDropMessage,
  isValidDropPath,
  MAX_BODY_CHARS,
  MAX_CONTACT_CHARS,
} from "./dropbox";

const NOW = "2026-07-12T04:00:00.000Z";

describe("buildMessage", () => {
  it("trims and canonicalizes a plain message", () => {
    const r = buildMessage("  hello there  ", "", NOW);
    expect(r).toEqual({
      ok: true,
      message: { v: 1, body: "hello there", at: NOW },
    });
  });
  it("keeps a non-empty contact, drops an empty one", () => {
    const withContact = buildMessage("hi", "  me@example.com ", NOW);
    expect(withContact.ok && withContact.message.contact).toBe(
      "me@example.com",
    );
    const without = buildMessage("hi", "   ", NOW);
    expect(without.ok && "contact" in without.message).toBe(false);
  });
  it("rejects an empty or whitespace-only body", () => {
    expect(buildMessage("", "", NOW)).toEqual({ ok: false, error: "empty" });
    expect(buildMessage("   \n\t ", "", NOW)).toEqual({
      ok: false,
      error: "empty",
    });
  });
  it("enforces the body and contact caps (on the trimmed length)", () => {
    expect(buildMessage("x".repeat(MAX_BODY_CHARS + 1), "", NOW)).toEqual({
      ok: false,
      error: "too-long",
    });
    // exactly at the cap is allowed
    expect(buildMessage("x".repeat(MAX_BODY_CHARS), "", NOW).ok).toBe(true);
    expect(buildMessage("hi", "c".repeat(MAX_CONTACT_CHARS + 1), NOW)).toEqual({
      ok: false,
      error: "contact-too-long",
    });
  });
});

describe("isDropMessage", () => {
  it("accepts a well-formed message with and without contact", () => {
    expect(isDropMessage({ v: 1, body: "hi", at: NOW })).toBe(true);
    expect(isDropMessage({ v: 1, body: "hi", contact: "x", at: NOW })).toBe(
      true,
    );
  });
  it("rejects wrong version, missing fields, or bad types", () => {
    expect(isDropMessage({ v: 2, body: "hi", at: NOW })).toBe(false);
    expect(isDropMessage({ v: 1, at: NOW })).toBe(false);
    expect(isDropMessage({ v: 1, body: 5, at: NOW })).toBe(false);
    expect(isDropMessage({ v: 1, body: "hi", contact: 5, at: NOW })).toBe(
      false,
    );
    expect(isDropMessage(null)).toBe(false);
  });
});

describe("isDropboxKey", () => {
  const good = {
    v: 1,
    alg: "ECDH-P256",
    pub_b64: "AAAA",
    sealed_priv_b64: "BBBB",
  };
  it("accepts a well-formed key record", () => {
    expect(isDropboxKey(good)).toBe(true);
  });
  it("rejects a wrong version, alg, empty or oversized fields", () => {
    expect(isDropboxKey({ ...good, v: 2 })).toBe(false);
    expect(isDropboxKey({ ...good, alg: "RSA" })).toBe(false);
    expect(isDropboxKey({ ...good, pub_b64: "" })).toBe(false);
    expect(isDropboxKey({ ...good, pub_b64: "x".repeat(121) })).toBe(false);
    expect(isDropboxKey({ ...good, sealed_priv_b64: "x".repeat(4097) })).toBe(
      false,
    );
    expect(isDropboxKey(null)).toBe(false);
  });
});

describe("isValidDropPath / dropPath", () => {
  it("accepts the exact stored shape and rejects everything else", () => {
    const p = dropPath("mB4d5S3CkQxGxUKz2AkKfg");
    expect(p).toBe("dropbox/mB4d5S3CkQxGxUKz2AkKfg.bin");
    expect(isValidDropPath(p)).toBe(true);
    expect(isValidDropPath("dropbox/x.bin")).toBe(true);
    // structurally can't reach key material or another prefix
    expect(isValidDropPath("meta/dropboxkey")).toBe(false);
    expect(isValidDropPath("dropbox/../meta/keystore")).toBe(false);
    expect(isValidDropPath("inbox/x.bin")).toBe(false);
    expect(isValidDropPath("dropbox/x.txt")).toBe(false);
    expect(isValidDropPath("dropbox/.bin")).toBe(false);
  });
});
