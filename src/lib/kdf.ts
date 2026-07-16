import { argon2id } from "hash-wasm";
import {
  deriveKek,
  fromB64url,
  isArgonKdf,
  ITERATIONS,
  randomSalt,
  toB64url,
  type KdfArgon2id,
  type Keystore,
} from "./crypto";

/**
 * kdf — the versioned passphrase→KEK dispatcher (ADR: Argon2id). PBKDF2 was the
 * softest spot in the whole hierarchy: compute-hard but memory-CHEAP, which is
 * exactly what GPU farms parallelize almost for free. Argon2id (the
 * password-hashing-competition winner) forces every guess to occupy real RAM,
 * so the parallelism that makes offline cracking economical stops scaling —
 * same passphrase, orders of magnitude more expensive to attack.
 *
 * The WASM comes from `hash-wasm` (lockfile-pinned, compiled from the reference
 * implementation, bundled inline — same-origin, no CDN, per the CSP's rules;
 * the cost is `'wasm-unsafe-eval'` in script-src, moved with its locks in the
 * same commit). Its conformance is proven in CI against reference-implementation
 * test vectors, not assumed.
 *
 * Keystores migrate LAZILY: unlock derives with whatever the keystore says, and
 * a successful PBKDF2 unlock immediately re-wraps under a fresh Argon2id KEK —
 * no flag day, no re-encryption of any blob (the MK never changes). WASM init
 * can fail (exotic browsers, memory pressure): failure degrades to PBKDF2
 * exactly as today and does NOT migrate — the upgrade only happens when the
 * stronger path works end-to-end.
 */

/** The OWASP-recommended interactive profile: 64 MiB, 3 passes, 1 lane. */
export const ARGON2_M = 65_536; // KiB
export const ARGON2_T = 3;
export const ARGON2_P = 1;

/** Derive the AES-GCM key-encryption key via Argon2id. Non-extractable, wrap/
 *  unwrap only — the same contract as `crypto.deriveKek`. */
export async function deriveKekArgon2(
  passphrase: string,
  salt: Uint8Array,
  params: Pick<KdfArgon2id, "m" | "t" | "p">,
): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passphrase,
    salt,
    iterations: params.t,
    memorySize: params.m,
    parallelism: params.p,
    hashLength: 32,
    outputType: "binary",
  });
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "wrapKey",
    "unwrapKey",
  ]);
}

// The probe result is per-session: WASM either initializes here or it doesn't.
let availableProbe: Promise<boolean> | null = null;

/** Whether Argon2id actually runs END-TO-END in this environment — a tiny
 *  throwaway derivation, memoized. Anything short of success is "no". */
export function argon2Available(): Promise<boolean> {
  availableProbe ??= argon2id({
    password: "probe",
    salt: new Uint8Array(16),
    iterations: 1,
    memorySize: 64,
    parallelism: 1,
    hashLength: 16,
    outputType: "binary",
  }).then(
    (out) => out.length === 16,
    () => false,
  );
  return availableProbe;
}

/** The kdf block for a NEW (or re-wrapped) keystore: Argon2id with a fresh salt
 *  when the WASM works, else PBKDF2 exactly as before — the guarded degrade. */
export async function freshKdf(): Promise<Keystore["kdf"]> {
  const salt_b64 = toB64url(randomSalt());
  return (await argon2Available())
    ? { algo: "argon2id", salt_b64, m: ARGON2_M, t: ARGON2_T, p: ARGON2_P }
    : { salt_b64, iterations: ITERATIONS };
}

/** THE dispatcher — every KEK consumer derives through here, with whatever the
 *  keystore's kdf block says. One call site per consumer, no algo knowledge. */
export function deriveKekForKdf(
  kdf: Keystore["kdf"],
  passphrase: string,
): Promise<CryptoKey> {
  return isArgonKdf(kdf)
    ? deriveKekArgon2(passphrase, fromB64url(kdf.salt_b64), kdf)
    : deriveKek(passphrase, fromB64url(kdf.salt_b64), kdf.iterations);
}
