import { createHmac, timingSafeEqual } from "node:crypto";
import { fromB64url, toB64url } from "@/lib/crypto";

/**
 * The DB-free half of a WebAuthn ceremony: the per-ceremony random challenge
 * rides in a short-lived, HttpOnly, SameSite=Strict cookie instead of a server
 * table. Format: `base64url(JSON{c,t,exp}) + "." + base64url(HMAC-SHA256)`,
 * keyed by AUTH_SECRET — the same secret that already signs the session JWT,
 * so a challenge is exactly as forgeable as a session (i.e. not).
 *
 * `t` binds the cookie to one ceremony kind ("reg" | "auth") so a registration
 * challenge can never satisfy an authentication verify or vice versa. The
 * verify call clears the cookie best-effort; the hard replay bound is the TTL,
 * and replaying within it needs the HttpOnly cookie plus a captured assertion —
 * an attacker with both already owns the browser.
 */
export const CHALLENGE_COOKIE = "webauthn-challenge";
export const CHALLENGE_TTL_S = 120;

export type ChallengeType = "reg" | "auth";

const enc = new TextEncoder();

function mac(payload: string, secret: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update(payload).digest());
}

/** challenge (base64url) + type + TTL → the signed cookie value. */
export function sealChallenge(
  challenge: string,
  type: ChallengeType,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const payload = toB64url(
    enc.encode(
      JSON.stringify({
        c: challenge,
        t: type,
        exp: Math.floor(nowMs / 1000) + CHALLENGE_TTL_S,
      }),
    ),
  );
  return `${payload}.${toB64url(mac(payload, secret))}`;
}

/**
 * Signed cookie value → the challenge, or null on ANY defect: bad shape, bad
 * signature (constant-time compare), wrong ceremony type, or expiry. Callers
 * treat null as "no ceremony in flight" — the client just retries the door.
 */
export function openChallenge(
  value: string,
  expected: ChallengeType,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return null;
  const payload = value.slice(0, dot);
  let sig: Uint8Array;
  try {
    sig = fromB64url(value.slice(dot + 1));
  } catch {
    return null;
  }
  const want = mac(payload, secret);
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;

  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(fromB64url(payload)),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (p.t !== expected) return null;
    if (typeof p.exp !== "number" || Math.floor(nowMs / 1000) >= p.exp)
      return null;
    return typeof p.c === "string" && p.c.length > 0 ? p.c : null;
  } catch {
    return null;
  }
}

/**
 * Set-Cookie header values. Path=/api/auth covers both consumers: the Auth.js
 * callback (/api/auth/callback/webauthn) and the register-verify route
 * (/api/auth/webauthn/register-verify). `secure` comes from the rp config —
 * only https origins may carry the attribute (localhost dev + e2e are http).
 */
export function challengeSetCookie(value: string, secure: boolean): string {
  return `${CHALLENGE_COOKIE}=${value}; Max-Age=${CHALLENGE_TTL_S}; Path=/api/auth; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function challengeClearCookie(secure: boolean): string {
  return `${CHALLENGE_COOKIE}=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** Pull the challenge cookie out of a raw Cookie header, null when absent. */
export function challengeFromCookieHeader(
  header: string | null,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === CHALLENGE_COOKIE) {
      const v = part.slice(eq + 1).trim();
      return v.length > 0 ? v : null;
    }
  }
  return null;
}
