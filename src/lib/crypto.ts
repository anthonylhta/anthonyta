/**
 * crypto — the client-side E2EE core for the files inbox (ADR 0053). Pure WebCrypto,
 * zero dependencies, no imports: the same module runs in the window, a worker, and
 * Node-vitest (`globalThis.crypto` everywhere). The server never sees any of this —
 * it stores what these functions emit and nothing else.
 *
 * Key hierarchy (the Bitwarden shape): a passphrase + salt is stretched by PBKDF2
 * into a KEK, which wraps a once-generated random AES-GCM master key (MK). Every
 * item is sealed under the MK, so changing the passphrase only re-wraps ~32 bytes —
 * the data is never re-encrypted. There is deliberately no passphrase verifier:
 * a wrong passphrase makes the GCM unwrap fail its auth check, which IS the answer.
 *
 * Envelope (versioned binary): `"AEV1" + IV(12) + AES-GCM(mk, payload, aad="AEV1")`
 * where payload = uint32-BE headerLen + JSON{n,t,s} + raw bytes. The magic rides as
 * AAD so the version bytes are authenticated too — a tampered header fails the tag,
 * not just a string compare. A fresh random 96-bit IV per item is safe far past any
 * realistic item count under a single random key.
 *
 * Sealed box (ASB1): a write-only channel FOR the server. The nightly cron encrypts
 * snapshots to the owner's static public key and holds no key to reopen them — the
 * private half lives only behind the passphrase. Ephemeral-static ECDH on P-256
 * (chosen over X25519 for universal WebCrypto support): every message mints a fresh
 * ephemeral keypair, ECDHs it against the recipient's static public key, and HKDFs
 * the shared bits into a one-shot AES-256-GCM key.
 *
 * Box envelope: `"ASB1" + ephPubRaw(65) + IV(12) + AES-GCM(k, plaintext, aad="ASB1")`
 * where k = HKDF-SHA256(bits=ECDH(eph_priv, recipient_pub), salt=32 zero bytes,
 * info="ASB1" || ephPubRaw(65) || recipientPubRaw(65)). ephPubRaw / recipientPubRaw
 * are the 65-byte uncompressed ("raw") P-256 points. Binding BOTH points into the
 * HKDF info means a swapped/tampered ephemeral or a wrong recipient derives a
 * different key and GCM fails closed — that binding, not a length check, is what
 * authenticates a box that carries no signature.
 */

export const MAGIC = "AEV1";
export const ITERATIONS = 600_000; // OWASP floor for PBKDF2-SHA256 (2023+)
export const IV_LEN = 12; // AES-GCM's standard 96-bit nonce
export const SALT_LEN = 16;


const MAGIC_BYTES = new TextEncoder().encode(MAGIC);

/** Plaintext metadata sealed inside the envelope, invisible to the server. */
export interface EnvelopeMeta {
  /** Original filename. */
  n: string;
  /** MIME type ("" when unknown). */
  t: string;
  /** Original byte size. */
  s: number;
}

/**
 * The KEK-wrapped master key + its KDF parameters — the only key material that
 * ever leaves the device, stored at `meta/keystore`. Iterations live here (not in
 * code) so they can be raised later without breaking old keystores; `v` gates
 * format migrations.
 */
export interface Keystore {
  v: 1;
  kdf: { salt_b64: string; iterations: number };
  wrapped_mk_b64: string;
  iv_b64: string;
}

// ---------------------------------------------------------------------------
// base64url + random helpers
// ---------------------------------------------------------------------------

export function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 16 random bytes as 22 chars of base64url — the blob-name id for `e-<id>.bin`. */
export function randomId(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LEN));
}

// ---------------------------------------------------------------------------
// KDF + key wrapping
// ---------------------------------------------------------------------------

/**
 * passphrase + salt → the key-encryption key. The iteration count is the whole
 * defense against offline guessing of the stored keystore, so it's a parameter
 * (read back from the keystore) rather than a constant baked into every call.
 */
export async function deriveKek(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = ITERATIONS,
): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations,
    },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * A fresh random 256-bit master key. Extractable ONLY so it can be wrapped once
 * during setup — the caller must discard this handle immediately after `wrapMk`
 * and keep the non-extractable key `unwrapMk` returns.
 */
export function generateMk(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]) as Promise<CryptoKey>;
}

/** KEK-encrypt the MK for storage; returns the wrapped bytes + the IV used. */
export async function wrapMk(
  mk: CryptoKey,
  kek: CryptoKey,
): Promise<{ wrapped: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const wrapped = await crypto.subtle.wrapKey("raw", mk, kek, {
    name: "AES-GCM",
    iv: iv as BufferSource,
  });
  return { wrapped: new Uint8Array(wrapped), iv };
}

/**
 * Decrypt the stored MK with a passphrase-derived KEK. Returns a NON-extractable
 * key — the only form the app ever holds after setup. A wrong passphrase fails
 * GCM's auth check and this throws; that failure is the passphrase check.
 *
 * `extractable: true` exists for exactly one flow — passphrase change, where the
 * MK must be momentarily wrappable again (WebCrypto refuses to wrap a
 * non-extractable key). Callers re-wrap and discard that handle immediately.
 */
export function unwrapMk(
  wrapped: Uint8Array,
  iv: Uint8Array,
  kek: CryptoKey,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    wrapped as BufferSource,
    kek,
    { name: "AES-GCM", iv: iv as BufferSource },
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"],
  ) as Promise<CryptoKey>;
}

// ---------------------------------------------------------------------------
// keystore (the stored JSON around the wrapped MK)
// ---------------------------------------------------------------------------

export function buildKeystore(
  salt: Uint8Array,
  iterations: number,
  wrapped: Uint8Array,
  iv: Uint8Array,
): Keystore {
  return {
    v: 1,
    kdf: { salt_b64: toB64url(salt), iterations },
    wrapped_mk_b64: toB64url(wrapped),
    iv_b64: toB64url(iv),
  };
}

/** Shape check for anything claiming to be a keystore (server PUT gate + client parse). */
export function isKeystore(x: unknown): x is Keystore {
  if (typeof x !== "object" || x === null) return false;
  const k = x as Record<string, unknown>;
  const kdf = k.kdf as Record<string, unknown> | undefined;
  return (
    k.v === 1 &&
    typeof kdf === "object" &&
    kdf !== null &&
    typeof kdf.salt_b64 === "string" &&
    typeof kdf.iterations === "number" &&
    Number.isInteger(kdf.iterations) &&
    kdf.iterations >= 100_000 &&
    kdf.iterations <= 10_000_000 &&
    typeof k.wrapped_mk_b64 === "string" &&
    k.wrapped_mk_b64.length > 0 &&
    k.wrapped_mk_b64.length <= 128 &&
    typeof k.iv_b64 === "string" &&
    k.iv_b64.length > 0 &&
    k.iv_b64.length <= 32
  );
}

// ---------------------------------------------------------------------------
// envelope seal / open
// ---------------------------------------------------------------------------

/** meta + plaintext → one self-describing ciphertext envelope (the stored blob). */
export async function seal(
  mk: CryptoKey,
  meta: EnvelopeMeta,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const payload = new Uint8Array(4 + header.length + bytes.length);
  new DataView(payload.buffer).setUint32(0, header.length);
  payload.set(header, 4);
  payload.set(bytes, 4 + header.length);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: MAGIC_BYTES as BufferSource,
      },
      mk,
      payload as BufferSource,
    ),
  );

  const out = new Uint8Array(MAGIC_BYTES.length + IV_LEN + ct.length);
  out.set(MAGIC_BYTES, 0);
  out.set(iv, MAGIC_BYTES.length);
  out.set(ct, MAGIC_BYTES.length + IV_LEN);
  return out;
}

/**
 * envelope → { meta, bytes }. Throws on anything that isn't a well-formed AEV1
 * envelope sealed under `mk`: bad magic, truncation, a flipped ciphertext byte,
 * or a header that doesn't parse. Callers treat any throw as "not decryptable".
 */
export async function open(
  mk: CryptoKey,
  envelope: Uint8Array,
): Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }> {
  const minLen = MAGIC_BYTES.length + IV_LEN + 16; // + GCM tag
  if (envelope.length < minLen) throw new Error("envelope: truncated");
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (envelope[i] !== MAGIC_BYTES[i]) throw new Error("envelope: bad magic");
  }

  const iv = envelope.subarray(MAGIC_BYTES.length, MAGIC_BYTES.length + IV_LEN);
  const ct = envelope.subarray(MAGIC_BYTES.length + IV_LEN);
  // GCM authenticates ct + AAD here; tampering anywhere throws.
  const payload = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: MAGIC_BYTES as BufferSource,
      },
      mk,
      ct as BufferSource,
    ),
  );

  if (payload.length < 4) throw new Error("envelope: bad payload");
  const headerLen = new DataView(payload.buffer, payload.byteOffset).getUint32(
    0,
  );
  if (headerLen > payload.length - 4) throw new Error("envelope: bad header");

  const meta = JSON.parse(
    new TextDecoder().decode(payload.subarray(4, 4 + headerLen)),
  ) as EnvelopeMeta;
  if (typeof meta?.n !== "string" || typeof meta?.t !== "string")
    throw new Error("envelope: bad meta");

  return { meta, bytes: payload.slice(4 + headerLen) };
}

// ---------------------------------------------------------------------------
// share keys — a one-time key per share link (rides in the URL #fragment)
// ---------------------------------------------------------------------------

/**
 * A fresh one-time AES-GCM key for a single share. Extractable ONLY so its raw bytes
 * can travel after the `#` in a share URL; it is never the master key and never
 * touches storage, so a leaked link burns exactly one file and nothing more.
 */
export function generateShareKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]) as Promise<CryptoKey>;
}

/** The raw 32 bytes of a share key — the material that goes in the URL fragment. */
export async function exportKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

/**
 * Import a share key from the fragment on the RECIPIENT side: decrypt-only and
 * non-extractable, so opening the link reveals the one file's bytes but the key can
 * never be re-exported or used to seal anything new.
 */
export function importShareKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
}
