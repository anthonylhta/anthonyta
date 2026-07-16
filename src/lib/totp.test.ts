import { describe, expect, it } from "vitest";
import {
  b32decode,
  codeAt,
  hotp,
  isTotpConfig,
  parseOtpauth,
  secondsLeft,
  toOtpauth,
  type TotpEntry,
} from "./totp";

// The base32 of the RFC test seeds. Each is the ASCII string "12345678901234567890…"
// base32-encoded. "1234567890" (10 bytes, a multiple of 5) encodes to "GEZDGNBVGY3TQOJQ"
// cleanly, so the repeated seeds are that block repeated plus a tail. Verified below via
// b32decode against the raw ASCII, so a transcription slip fails loudly and early.
const SHA1_SEED_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // 20-byte "12345678901234567890"
const SHA256_SEED_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA"; // 32-byte
const SHA512_SEED_B32 =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA"; // 64-byte

const ascii = (s: string) => new TextEncoder().encode(s);

describe("b32decode — the RFC seeds map back to their ASCII bytes", () => {
  it("SHA-1 / SHA-256 / SHA-512 seeds decode to the documented ASCII secrets", () => {
    expect(b32decode(SHA1_SEED_B32)).toEqual(ascii("12345678901234567890"));
    expect(b32decode(SHA256_SEED_B32)).toEqual(
      ascii("12345678901234567890123456789012"),
    );
    expect(b32decode(SHA512_SEED_B32)).toEqual(
      ascii("1234567890123456789012345678901234567890123456789012345678901234"),
    );
  });
});

// ---------------------------------------------------------------------------
// 1. RFC 4226 Appendix D — HOTP-SHA1, 6 digits, secret "12345678901234567890"
// ---------------------------------------------------------------------------
describe("hotp — RFC 4226 Appendix D (all ten published values)", () => {
  const secret = ascii("12345678901234567890");
  // RFC 4226 Appendix D, "Truncated Values" column, counts 0..9.
  const VECTORS = [
    "755224",
    "287082",
    "359152",
    "969429",
    "338314",
    "254676",
    "287922",
    "162583",
    "399871",
    "520489",
  ];
  it.each(VECTORS.map((v, i) => [i, v] as const))(
    "counter %i → %s",
    async (counter, expected) => {
      expect(await hotp(secret, counter, "SHA-1", 6)).toBe(expected);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. RFC 6238 Appendix B — TOTP, 8 digits, period 30, T0 0, all three hashes.
//    Tested through codeAt with the base32 of each hash's ASCII seed.
// ---------------------------------------------------------------------------
describe("codeAt — RFC 6238 Appendix B (every row, every hash)", () => {
  const entry = (secret_b32: string, algo: TotpEntry["algo"]): TotpEntry => ({
    issuer: "",
    account: "",
    secret_b32,
    algo,
    digits: 8,
    period: 30,
  });
  const SHA1 = entry(SHA1_SEED_B32, "SHA-1");
  const SHA256 = entry(SHA256_SEED_B32, "SHA-256");
  const SHA512 = entry(SHA512_SEED_B32, "SHA-512");

  // Columns transcribed from RFC 6238 Appendix B (Time in seconds | TOTP | Mode).
  // [unixSeconds, SHA1, SHA256, SHA512]
  const ROWS: Array<[number, string, string, string]> = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];

  it.each(ROWS)(
    "t=%i seconds → SHA1 %s / SHA256 %s / SHA512 %s",
    async (seconds, s1, s256, s512) => {
      const ms = seconds * 1000;
      expect(await codeAt(SHA1, ms)).toBe(s1);
      expect(await codeAt(SHA256, ms)).toBe(s256);
      expect(await codeAt(SHA512, ms)).toBe(s512);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. base32 matrix — tolerance + RFC 4648 vectors + rejection.
// ---------------------------------------------------------------------------
describe("b32decode — tolerance", () => {
  const canonical = "MZXW6YTBOI======"; // "foobar"
  const bytes = ascii("foobar");
  it("canonical, lowercase, unpadded, spaced and dashed all decode identically", () => {
    expect(b32decode(canonical)).toEqual(bytes);
    expect(b32decode(canonical.toLowerCase())).toEqual(bytes);
    expect(b32decode("MZXW6YTBOI")).toEqual(bytes); // no padding
    expect(b32decode("MZXW 6YTB OI==")).toEqual(bytes); // embedded spaces
    expect(b32decode("MZXW-6YTB-OI")).toEqual(bytes); // dashes (grouped display)
  });
});

describe("b32decode — RFC 4648 §10 test vectors", () => {
  // BASE32("") = "", BASE32("f") = "MY======", etc.
  const VECTORS: Array<[string, string]> = [
    ["", ""],
    ["f", "MY======"],
    ["fo", "MZXQ===="],
    ["foo", "MZXW6==="],
    ["foob", "MZXW6YQ="],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI======"],
  ];
  it.each(VECTORS)("decodes BASE32(%j) back to its bytes", (plain, encoded) => {
    expect(b32decode(encoded)).toEqual(ascii(plain));
  });
});

describe("b32decode — rejection", () => {
  it("returns null for out-of-alphabet characters", () => {
    expect(b32decode("MZXW0YTB")).toBeNull(); // 0 is not a base32 digit
    expect(b32decode("MZXW1YTB")).toBeNull(); // 1 is not a base32 digit
    expect(b32decode("MZXW6YT8")).toBeNull(); // 8 is not a base32 digit
    expect(b32decode("MZXW6YT!")).toBeNull(); // punctuation
  });
  it("returns null for lengths that leave an orphaned character", () => {
    expect(b32decode("A")).toBeNull(); // 1 char, 5 dangling bits
    expect(b32decode("ABC")).toBeNull(); // 3 chars
    expect(b32decode("ABCDEF")).toBeNull(); // 6 chars
  });
});

// ---------------------------------------------------------------------------
// 4. period boundaries.
// ---------------------------------------------------------------------------
describe("period boundaries (30s)", () => {
  const entry: TotpEntry = {
    issuer: "",
    account: "",
    secret_b32: SHA1_SEED_B32,
    algo: "SHA-1",
    digits: 6,
    period: 30,
  };
  it("the code changes as the counter ticks over at 60s", async () => {
    expect(await codeAt(entry, 59_999)).not.toBe(await codeAt(entry, 60_000));
  });
  it("secondsLeft counts down to the boundary and resets", () => {
    expect(secondsLeft(entry, 59_000)).toBe(1); // 59s → 1s until the 60s step
    expect(secondsLeft(entry, 60_000)).toBe(30); // exactly on a step → a full window
  });
});

// ---------------------------------------------------------------------------
// 5. parseOtpauth matrix.
// ---------------------------------------------------------------------------
describe("parseOtpauth", () => {
  it("issuer in both label and param → the param wins", () => {
    const e = parseOtpauth(
      "otpauth://totp/ACME:alice@acme.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Inc",
    );
    expect(e).not.toBeNull();
    expect(e!.issuer).toBe("ACME Inc"); // param, not the "ACME" label prefix
    expect(e!.account).toBe("alice@acme.com");
    expect(e!.secret_b32).toBe("JBSWY3DPEHPK3PXP");
    expect(e!.algo).toBe("SHA-1"); // default
    expect(e!.digits).toBe(6); // default
    expect(e!.period).toBe(30); // default
  });
  it("issuer only in the label prefix", () => {
    const e = parseOtpauth("otpauth://totp/GitHub:bob?secret=JBSWY3DPEHPK3PXP");
    expect(e!.issuer).toBe("GitHub");
    expect(e!.account).toBe("bob");
  });
  it("a bare account label (no issuer)", () => {
    const e = parseOtpauth("otpauth://totp/bob?secret=JBSWY3DPEHPK3PXP");
    expect(e!.issuer).toBe("");
    expect(e!.account).toBe("bob");
  });
  it("percent-encoded label decodes before splitting", () => {
    const e = parseOtpauth(
      "otpauth://totp/Example%3AAlice%20Smith?secret=JBSWY3DPEHPK3PXP",
    );
    expect(e!.issuer).toBe("Example");
    expect(e!.account).toBe("Alice Smith");
  });
  it("parses algorithm, digits and period", () => {
    const e = parseOtpauth(
      "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA512&digits=8&period=60",
    );
    expect(e!.algo).toBe("SHA-512");
    expect(e!.digits).toBe(8);
    expect(e!.period).toBe(60);
  });
  it("SHA256 maps to the union member", () => {
    const e = parseOtpauth(
      "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256",
    );
    expect(e!.algo).toBe("SHA-256");
  });
  it("null for a non-totp type, missing/garbage secret, and non-URIs", () => {
    expect(
      parseOtpauth("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=0"),
    ).toBeNull(); // hotp, not totp
    expect(parseOtpauth("otpauth://totp/x?issuer=ACME")).toBeNull(); // no secret
    expect(parseOtpauth("otpauth://totp/x?secret=8!!!not-base32")).toBeNull(); // undecodable
    expect(parseOtpauth("not a uri at all")).toBeNull();
    expect(
      parseOtpauth("https://example.com/?secret=JBSWY3DPEHPK3PXP"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. toOtpauth → parseOtpauth round-trip.
// ---------------------------------------------------------------------------
describe("toOtpauth ⇄ parseOtpauth", () => {
  it("round-trips every field", () => {
    const entry: TotpEntry = {
      issuer: "GitHub",
      account: "anthony@example.com",
      secret_b32: "JBSWY3DPEHPK3PXP",
      algo: "SHA-256",
      digits: 8,
      period: 60,
    };
    expect(parseOtpauth(toOtpauth(entry))).toEqual(entry);
  });
  it("round-trips a bare account (empty issuer)", () => {
    const entry: TotpEntry = {
      issuer: "",
      account: "solo",
      secret_b32: "JBSWY3DPEHPK3PXP",
      algo: "SHA-1",
      digits: 6,
      period: 30,
    };
    expect(parseOtpauth(toOtpauth(entry))).toEqual(entry);
  });
});

// ---------------------------------------------------------------------------
// 7. isTotpConfig guard matrix.
// ---------------------------------------------------------------------------
describe("isTotpConfig", () => {
  const entry: TotpEntry = {
    issuer: "GitHub",
    account: "bob",
    secret_b32: "JBSWY3DPEHPK3PXP",
    algo: "SHA-1",
    digits: 6,
    period: 30,
  };
  const cfg = { v: 1, entries: [entry] };

  it("accepts a well-formed config and tolerates extra unknown keys", () => {
    expect(isTotpConfig(cfg)).toBe(true);
    expect(isTotpConfig({ v: 1, entries: [] })).toBe(true); // empty is valid
    expect(isTotpConfig({ ...cfg, note: "forward-compat" })).toBe(true);
  });
  it("rejects non-objects and the wrong version", () => {
    expect(isTotpConfig(null)).toBe(false);
    expect(isTotpConfig("x")).toBe(false);
    expect(isTotpConfig({ v: 2, entries: [] })).toBe(false);
    expect(isTotpConfig({ entries: [] })).toBe(false);
    expect(isTotpConfig({ v: 1 })).toBe(false); // no entries array
  });
  it("rejects a bad algo", () => {
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, algo: "MD5" }] })).toBe(
      false,
    );
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, algo: "sha-1" }] })).toBe(
      false,
    );
  });
  it("rejects out-of-range or non-integer digits", () => {
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, digits: 3 }] })).toBe(
      false,
    );
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, digits: 11 }] })).toBe(
      false,
    );
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, digits: 6.5 }] })).toBe(
      false,
    );
  });
  it("rejects out-of-range period", () => {
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, period: 4 }] })).toBe(
      false,
    );
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, period: 301 }] })).toBe(
      false,
    );
  });
  it("rejects an empty or non-string secret and non-string label fields", () => {
    expect(
      isTotpConfig({ v: 1, entries: [{ ...entry, secret_b32: "" }] }),
    ).toBe(false);
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, secret_b32: 5 }] })).toBe(
      false,
    );
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, issuer: 5 }] })).toBe(
      false,
    );
    expect(isTotpConfig({ v: 1, entries: [{ ...entry, account: null }] })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 8. codeAt fails soft on an undecodable seed (returns null, never throws).
// ---------------------------------------------------------------------------
describe("codeAt — undecodable seed", () => {
  it("returns null instead of throwing", async () => {
    const entry: TotpEntry = {
      issuer: "",
      account: "",
      secret_b32: "not base32 !!!",
      algo: "SHA-1",
      digits: 6,
      period: 30,
    };
    expect(await codeAt(entry, 0)).toBeNull();
  });
});
