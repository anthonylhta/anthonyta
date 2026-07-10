import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { toB64url } from "@/lib/crypto";

/**
 * The one-time break-glass code (ADR 0022's door, lost-all-devices edition).
 * Minted at first enrollment, shown exactly once, and only its sha256 lands in
 * the record — the server can verify a presented code but never reproduce it.
 * Redeeming it is single-use: the hash is dropped from the record first, and a
 * fresh code is minted at the next first-class enrollment.
 */
export function mintRecoveryCode(): string {
  return toB64url(new Uint8Array(randomBytes(16)));
}

export function hashRecoveryCode(code: string): string {
  return toB64url(new Uint8Array(createHash("sha256").update(code).digest()));
}

/** Constant-time compare of a presented code against the stored hash. */
export function matchesRecoveryHash(code: string, hash_b64: string): boolean {
  const presented = createHash("sha256")
    .update(hashRecoveryCode(code))
    .digest();
  const stored = createHash("sha256").update(hash_b64).digest();
  return timingSafeEqual(presented, stored);
}
