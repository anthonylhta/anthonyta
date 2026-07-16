/**
 * Pure TOTP/HOTP core for the two-factor drawer — the ~30 lines of HMAC + arithmetic
 * behind the codes an authenticator app shows. The seeds live sealed in one E2EE
 * envelope (the owner's browser decrypts them); the CODES are computed here, entirely
 * client-side, so the server never sees a seed or a code. Owning the primitive instead
 * of pulling a dependency is worth it precisely because its correctness is pinned to
 * PUBLISHED test vectors (RFC 4226 Appendix D + RFC 6238 Appendix B), not to itself.
 *
 * Only `crypto.subtle` and the standard `TextEncoder`/`URL` globals — no store, no
 * `next` import, no Node-only APIs — so this layer runs unchanged in the window, a
 * worker, and Node-vitest, and is unit-testable on its own (mirrors lib/crypto,
 * lib/merkle). Time is always INJECTED, never sampled from the clock, so every code is
 * reproducible to the second.
 */

/** One stored seed + its parameters, in the exact shape a QR payload carries. */
export interface TotpEntry {
  /** The service name, e.g. "GitHub". */
  issuer: string;
  /** The account label, e.g. "anthony@…". May be "" (a bare, issuer-only label). */
  account: string;
  /** The shared secret, base32 as QR payloads and manual entry carry it. */
  secret_b32: string;
  /** The HMAC hash — already the WebCrypto hash name, so no mapping is needed. */
  algo: "SHA-1" | "SHA-256" | "SHA-512";
  /** Code length; 6 is near-universal, 7–8 appear. */
  digits: number;
  /** Time step in seconds; 30 is near-universal. */
  period: number;
}

/** The sealed drawer payload: a versioned list of entries. */
export interface TotpConfig {
  v: 1;
  entries: TotpEntry[];
}

const ALGOS: ReadonlySet<string> = new Set(["SHA-1", "SHA-256", "SHA-512"]);

/**
 * Shape guard for a decrypted config (client parse). Every entry must be fully
 * well-formed — a malformed one would either throw at code time or silently generate
 * garbage, so it's rejected here at the boundary. Bounds are deliberately loose
 * (digits 4..10, period 5..300) to admit every real authenticator without admitting
 * nonsense. Extra unknown keys on the CONFIG object ride through (forward-compat, like
 * isKeystore/isManifest), so an older client never rejects a newer drawer.
 */
export function isTotpConfig(x: unknown): x is TotpConfig {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  if (c.v !== 1) return false;
  if (!Array.isArray(c.entries)) return false;
  for (const e of c.entries) {
    if (typeof e !== "object" || e === null) return false;
    const entry = e as Record<string, unknown>;
    if (typeof entry.issuer !== "string") return false;
    if (typeof entry.account !== "string") return false;
    if (typeof entry.secret_b32 !== "string" || entry.secret_b32.length === 0)
      return false;
    if (typeof entry.algo !== "string" || !ALGOS.has(entry.algo)) return false;
    if (
      typeof entry.digits !== "number" ||
      !Number.isInteger(entry.digits) ||
      entry.digits < 4 ||
      entry.digits > 10
    )
      return false;
    if (
      typeof entry.period !== "number" ||
      !Number.isInteger(entry.period) ||
      entry.period < 5 ||
      entry.period > 300
    )
      return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// base32 (RFC 4648)
// ---------------------------------------------------------------------------

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 4648 base32 decode — deliberately tolerant of the shapes real QR payloads and
 * manual entry actually produce: case-insensitive, `=` padding optional, and embedded
 * spaces / dashes (the grouping generators print) ignored. `null` for anything that
 * isn't valid base32 — an out-of-alphabet character, or a length whose leftover bit
 * count (chars mod 8 ∈ {1,3,6}) can't complete a byte. The empty string decodes to
 * zero bytes.
 */
export function b32decode(s: string): Uint8Array | null {
  const clean = s.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1; // keep only the leftover bits so `value` stays bounded
    }
  }
  // A valid encoding leaves < 5 dangling bits (0/2/4/5/7 chars per 8-char group);
  // 5+ leftover bits means an orphaned char (chars mod 8 ∈ {1,3,6}) — reject.
  if (bits >= 5) return null;
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// HOTP (RFC 4226) / TOTP (RFC 6238)
// ---------------------------------------------------------------------------

/**
 * RFC 4226 HOTP: HMAC(secret, 8-byte big-endian counter) → dynamic truncation
 * (§5.3) → mod 10^digits, left-padded to `digits`. `algo` is passed straight to
 * WebCrypto as the HMAC hash — the entry's union members ARE the WebCrypto names.
 */
export async function hotp(
  secret: Uint8Array,
  counter: number,
  algo: TotpEntry["algo"],
  digits: number,
): Promise<string> {
  // 8-byte big-endian counter. Counters are far below 2^53, so the split into two
  // 32-bit halves via arithmetic (not bit-ops, which top out at 32 bits) is exact.
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter % 2 ** 32);

  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, buf as BufferSource),
  );

  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks a
  // 4-byte window; the top bit of that window is masked off to stay unsigned.
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    (mac[offset] & 0x7f) * 2 ** 24 +
    (mac[offset + 1] & 0xff) * 2 ** 16 +
    (mac[offset + 2] & 0xff) * 2 ** 8 +
    (mac[offset + 3] & 0xff);

  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * RFC 6238 TOTP at a given instant: the time counter is floor(unixSeconds / period)
 * with T0 = 0. Time is INJECTED (`epochMs`), never read from the clock, so a code is
 * reproducible to the second — which is exactly what makes the published vectors
 * testable. Returns `null` (never throws) when the seed doesn't decode.
 */
export async function codeAt(
  entry: TotpEntry,
  epochMs: number,
): Promise<string | null> {
  const secret = b32decode(entry.secret_b32);
  if (secret === null) return null;
  const counter = Math.floor(Math.floor(epochMs / 1000) / entry.period);
  return hotp(secret, counter, entry.algo, entry.digits);
}

/** Seconds until the current code rolls over — for the drawer's countdown ring. */
export function secondsLeft(entry: TotpEntry, epochMs: number): number {
  const epochSeconds = Math.floor(epochMs / 1000);
  return entry.period - (epochSeconds % entry.period);
}

// ---------------------------------------------------------------------------
// otpauth:// URIs — import (QR / export) and export (anti-lock-in)
// ---------------------------------------------------------------------------

function mapAlgo(raw: string | null): TotpEntry["algo"] {
  switch ((raw ?? "").toUpperCase()) {
    case "SHA256":
      return "SHA-256";
    case "SHA512":
      return "SHA-512";
    default:
      return "SHA-1"; // absent, "SHA1", or anything unrecognized → the RFC default
  }
}

function intParam(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Parse an `otpauth://totp/…` URI — what authenticator QR codes and app exports carry.
 * Strict where it must be and lenient where it's safe, and it NEVER throws (junk → null):
 *
 *   - non-`totp` type (e.g. `otpauth://hotp/…`) → null;
 *   - a missing or undecodable `secret` → null;
 *   - the label is `"Issuer:account"` or a bare `"account"`, percent-decoded; the
 *     `issuer` PARAM takes precedence over the label prefix when both are present;
 *   - `algorithm` SHA1|SHA256|SHA512 → the entry union (default SHA-1), `digits`
 *     defaults 6, `period` defaults 30; unknown query params are ignored.
 *
 * The `secret` string is preserved verbatim (not re-encoded), so `toOtpauth`/`parseOtpauth`
 * round-trips it exactly.
 */
export function parseOtpauth(uri: string): TotpEntry | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null; // not a URI at all
  }
  if (url.protocol !== "otpauth:") return null;
  if (url.hostname.toLowerCase() !== "totp") return null; // hotp/… and junk types out

  const params = url.searchParams;
  const secret_b32 = params.get("secret");
  if (!secret_b32 || b32decode(secret_b32) === null) return null;

  // The label is the path minus its leading slash, percent-decoded. A malformed escape
  // shouldn't throw the whole parse — fall back to the raw path if decode fails.
  const rawLabel = url.pathname.replace(/^\//, "");
  let label: string;
  try {
    label = decodeURIComponent(rawLabel);
  } catch {
    label = rawLabel;
  }

  // "Issuer:account" splits on the first colon; a colonless label is the whole account.
  let labelIssuer = "";
  let account = label;
  const colon = label.indexOf(":");
  if (colon !== -1) {
    labelIssuer = label.slice(0, colon).trim();
    account = label.slice(colon + 1).trim();
  }

  const issuerParam = params.get("issuer");
  const issuer =
    issuerParam !== null && issuerParam !== "" ? issuerParam : labelIssuer;

  return {
    issuer,
    account,
    secret_b32,
    algo: mapAlgo(params.get("algorithm")),
    digits: intParam(params.get("digits"), 6),
    period: intParam(params.get("period"), 30),
  };
}

/**
 * The inverse of `parseOtpauth` — serialize an entry back to an `otpauth://totp/…` URI
 * so the drawer can re-export / re-QR a seed (anti-lock-in). Issuer and account are
 * percent-encoded into the `"Issuer:account"` label (issuer omitted from both label and
 * param when empty), and the algorithm is written in the URI's `SHA1` form.
 */
export function toOtpauth(entry: TotpEntry): string {
  const label = entry.issuer
    ? `${encodeURIComponent(entry.issuer)}:${encodeURIComponent(entry.account)}`
    : encodeURIComponent(entry.account);
  const params = new URLSearchParams();
  params.set("secret", entry.secret_b32);
  if (entry.issuer) params.set("issuer", entry.issuer);
  params.set("algorithm", entry.algo.replace("-", "")); // "SHA-1" → "SHA1"
  params.set("digits", String(entry.digits));
  params.set("period", String(entry.period));
  return `otpauth://totp/${label}?${params.toString()}`;
}
