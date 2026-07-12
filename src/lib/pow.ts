/**
 * Proof-of-work — a tiny, third-party-free spam gate for the public drop box. Instead
 * of a CAPTCHA (a tracking widget from someone else's server), the sender's browser
 * must find a nonce whose SHA-256 over the message ciphertext has N leading zero bits.
 * Finding it costs ~2^N hashes (a second or two on a phone at the shipped difficulty);
 * checking it costs one. The work is bound to the EXACT ciphertext, so a solution
 * can't be precomputed or replayed against a different message — the server needs no
 * challenge table and holds no state.
 *
 * Pure WebCrypto (`crypto.subtle` is present in the browser and in Node ≥ 20), so this
 * runs unchanged on the sender's device and in the ingest route, and is unit-testable
 * on its own.
 */

/** Shipped difficulty. 20 bits ≈ a million hashes — a beat on a phone, trivial to
 *  verify, and enough friction that scripted bulk submission stops being free. */
export const POW_BITS = 20;

/** Count leading zero BITS across a byte array (MSB-first within each byte). */
export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    // Math.clz32 counts 32-bit leading zeros; the byte sits in the low 8, so the
    // zero run above it is clz32(byte) - 24.
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** SHA-256 of `prefix || nonce` where the nonce is 8 little-endian bytes. */
async function hash(prefix: Uint8Array, nonce: number): Promise<Uint8Array> {
  const buf = new Uint8Array(prefix.length + 8);
  buf.set(prefix, 0);
  // 53-bit-safe LE encoding (nonces never approach 2^53 in practice).
  let n = nonce;
  for (let i = 0; i < 8; i++) {
    buf[prefix.length + i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", buf as BufferSource),
  );
}

/** True when `nonce` is a valid solution for `prefix` at `bits` difficulty. */
export async function verify(
  prefix: Uint8Array,
  nonce: number,
  bits: number = POW_BITS,
): Promise<boolean> {
  if (!Number.isSafeInteger(nonce) || nonce < 0) return false;
  return leadingZeroBits(await hash(prefix, nonce)) >= bits;
}

/**
 * Find a nonce whose hash over `prefix` clears `bits`. Scans from 0; the expected
 * count is ~2^bits. `signal` lets a UI abort a run (the sender navigating away); an
 * aborted solve rejects. Deterministic given the prefix, which makes it testable.
 */
export async function solve(
  prefix: Uint8Array,
  bits: number = POW_BITS,
  signal?: AbortSignal,
): Promise<number> {
  for (let nonce = 0; nonce <= Number.MAX_SAFE_INTEGER; nonce++) {
    if (signal?.aborted) throw new Error("aborted");
    if (leadingZeroBits(await hash(prefix, nonce)) >= bits) return nonce;
  }
  // Unreachable in practice — the loop finds a solution far below MAX_SAFE_INTEGER.
  throw new Error("no solution");
}
