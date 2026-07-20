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
 * AEV2 (context binding): the same frame with magic "AEV2", but the AAD is no longer
 * the bare magic — it's the domain-separated storage path `"aev2\0" || path`. The path
 * never travels with the envelope; it's re-derived from wherever the blob was fetched,
 * so a ciphertext served from the wrong address (a swapped `vault/a.bin`, last month's
 * `meta/fin`) fails the tag exactly like a bit flip. The meta still rides sealed in the
 * payload under that same tag, so a valid AEV2 open proves the bytes, the meta, AND the
 * address together — the (meta, path) pair, not either half alone. Migration is lazy:
 * `seal` without a context still emits AEV1 byte-for-byte, `open` dispatches on the
 * magic, and only v2 requires (and re-checks) the path — so a half-v1/half-v2 store is
 * a fully working store.
 *
 * Sealed box (ASB1): a write-only channel TO the owner. A stranger's browser on the
 * public contact page seals a drop-box message to the owner's published static public
 * key and keeps nothing — the private half lives only behind the passphrase, so the
 * server stores a message it can never read. Ephemeral-static ECDH on P-256 (chosen
 * over X25519 for universal WebCrypto support): every message mints a fresh ephemeral
 * keypair, ECDHs it against the recipient's static public key, and HKDFs the shared
 * bits into a one-shot AES-256-GCM key.
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
export const MAGIC_V2 = "AEV2"; // context-bound envelope: the storage path rides as AAD
export const ITERATIONS = 600_000; // OWASP floor for PBKDF2-SHA256 (2023+)
export const IV_LEN = 12; // AES-GCM's standard 96-bit nonce
export const SALT_LEN = 16;
export const BOX_MAGIC = "ASB1"; // anonymous sealed box (ephemeral-static ECDH)
export const BOX_PUB_LEN = 65; // uncompressed ("raw") P-256 point: 0x04 + X(32) + Y(32)

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
const MAGIC_V2_BYTES = new TextEncoder().encode(MAGIC_V2);
const BOX_MAGIC_BYTES = new TextEncoder().encode(BOX_MAGIC);

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
 *
 * v2 adds `canary_b64`: the fixed canary plaintext sealed under THIS keystore's
 * master key (see `sealCanary`). A cached key that can't open it belongs to a
 * different keystore — a vault reset on another device — so the boot path can drop
 * it instead of "unlocking" into row-by-row decrypt failures. v1 keystores carry
 * no canary and heal to v2 the next time the client holds the MK (unlock or
 * passphrase change); nothing needs migrating up front.
 */
/** The original KDF: PBKDF2-SHA256, identified by the ABSENCE of an `algo`
 *  discriminator (every keystore written before the Argon2id migration). */
export interface KdfPbkdf2 {
  salt_b64: string;
  iterations: number;
}

/** The memory-hard KDF (ADR: Argon2id): `m` in KiB, `t` passes, `p` lanes.
 *  Parameters are versioned IN the keystore, so future tuning is the same lazy
 *  migration again — the mechanism is the durable part. */
export interface KdfArgon2id {
  algo: "argon2id";
  salt_b64: string;
  m: number;
  t: number;
  p: number;
}

export interface Keystore {
  v: 1 | 2;
  kdf: KdfPbkdf2 | KdfArgon2id;
  wrapped_mk_b64: string;
  iv_b64: string;
  /** v2 only: the canary envelope (`sealCanary`), base64url. Absent on v1. */
  canary_b64?: string;
}

/** Discriminates the kdf union — the `algo` field is the whole signal. */
export function isArgonKdf(kdf: Keystore["kdf"]): kdf is KdfArgon2id {
  return "algo" in kdf && kdf.algo === "argon2id";
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

/**
 * Assemble the stored keystore around a ready kdf block (`lib/kdf.freshKdf`
 * decides pbkdf2 vs argon2id). Pass `canary_b64` (from `sealCanary`) to build a
 * v2 keystore; omit it for a bare v1. The canary is what the version gates — its
 * presence is the only difference between the two shapes.
 */
export function buildKeystore(
  kdf: Keystore["kdf"],
  wrapped: Uint8Array,
  iv: Uint8Array,
  canary_b64?: string,
): Keystore {
  const base = {
    kdf,
    wrapped_mk_b64: toB64url(wrapped),
    iv_b64: toB64url(iv),
  };
  return canary_b64 === undefined
    ? { v: 1, ...base }
    : { v: 2, ...base, canary_b64 };
}

/** Either kdf shape, bounds-checked: pbkdf2 by iteration range, argon2id by
 *  parameter ranges (m in KiB — 8 MiB floor keeps a downgrade attack from
 *  smuggling in a cheap-to-crack keystore; 1 GiB ceiling keeps a hostile one
 *  from OOMing the unlock). */
function isValidKdf(kdf: Record<string, unknown>): boolean {
  if (typeof kdf.salt_b64 !== "string" || kdf.salt_b64.length === 0)
    return false;
  if (kdf.algo === "argon2id") {
    return (
      typeof kdf.m === "number" &&
      Number.isInteger(kdf.m) &&
      kdf.m >= 8_192 &&
      kdf.m <= 1_048_576 &&
      typeof kdf.t === "number" &&
      Number.isInteger(kdf.t) &&
      kdf.t >= 1 &&
      kdf.t <= 16 &&
      typeof kdf.p === "number" &&
      Number.isInteger(kdf.p) &&
      kdf.p >= 1 &&
      kdf.p <= 4 &&
      kdf.iterations === undefined
    );
  }
  return (
    kdf.algo === undefined &&
    typeof kdf.iterations === "number" &&
    Number.isInteger(kdf.iterations) &&
    kdf.iterations >= 100_000 &&
    kdf.iterations <= 10_000_000
  );
}

/**
 * Shape check for anything claiming to be a keystore (server PUT gate + client
 * parse). Accepts both versions and both KDFs: v2 MUST carry a `canary_b64`
 * string, v1 MUST NOT — the field is exactly what distinguishes the two, so a
 * v2 without it (or a v1 with one) is malformed. The kdf block is either
 * legacy pbkdf2 (no `algo`) or argon2id — a half-and-half hybrid is rejected.
 */
export function isKeystore(x: unknown): x is Keystore {
  if (typeof x !== "object" || x === null) return false;
  const k = x as Record<string, unknown>;
  const kdf = k.kdf as Record<string, unknown> | undefined;
  const baseOk =
    (k.v === 1 || k.v === 2) &&
    typeof kdf === "object" &&
    kdf !== null &&
    isValidKdf(kdf) &&
    typeof k.wrapped_mk_b64 === "string" &&
    k.wrapped_mk_b64.length > 0 &&
    k.wrapped_mk_b64.length <= 128 &&
    typeof k.iv_b64 === "string" &&
    k.iv_b64.length > 0 &&
    k.iv_b64.length <= 32;
  if (!baseOk) return false;
  return k.v === 2
    ? typeof k.canary_b64 === "string" &&
        k.canary_b64.length > 0 &&
        k.canary_b64.length <= 256
    : k.canary_b64 === undefined;
}

// ---------------------------------------------------------------------------
// keystore canary — the cached key proves itself before it's trusted
// ---------------------------------------------------------------------------
//
// The IndexedDB-cached master key isn't bound to the keystore it came from: reset
// the vault on another device and the stale cache still "unlocks", then every
// decrypt fails one row at a time. The canary closes that gap — a tiny fixed
// plaintext sealed under the MK and carried in v2's `canary_b64`. Opening it at
// boot succeeds ONLY under the exact key that sealed it (the GCM tag is the
// comparison), so a wrong cached key fails loudly instead of silently.
//
// It's sealed under the MASTER KEY, not the KEK — so a passphrase change (which
// re-wraps the same MK) leaves it valid on every other device, while a genuine
// reset (a fresh MK) invalidates it everywhere at once. And because the MK is
// non-extractable, `open(canary)` is the only comparison available: a hash of the
// key can't be stored, but a non-extractable key can still *do*, and doing proves.

/** The AEV2 context the canary is sealed under — a fixed pseudo-path that
 *  domain-separates it from every real blob, so a canary ciphertext can never be
 *  confused with (or substituted from) another envelope under the same MK. */
const CANARY_CONTEXT = "meta/keystore#canary";

/** The canary plaintext: a fixed, domain-separated, NON-secret constant. Its
 *  contents are irrelevant — only that it opens under the right MK and fails
 *  under any other. */
const CANARY_PLAINTEXT = new TextEncoder().encode(
  "anthonyta:keystore-canary:1",
);
const CANARY_META: EnvelopeMeta = {
  n: "canary",
  t: "",
  s: CANARY_PLAINTEXT.length,
};

/**
 * Seal the fixed canary under `mk`, returning the base64url envelope for a v2
 * keystore's `canary_b64`. Callers hold the MK anyway (setup / passphrase change /
 * a fresh unlock), so this is a cheap add on a path that's already unlocked.
 */
export async function sealCanary(mk: CryptoKey): Promise<string> {
  return toB64url(
    await seal(mk, CANARY_META, CANARY_PLAINTEXT, CANARY_CONTEXT),
  );
}

/**
 * Does `mk` open `ks`'s canary? `true` when it does (the cached key belongs to
 * this keystore), `false` when it doesn't (a stale key from a reset elsewhere —
 * drop it), and `"absent"` for a v1 keystore that carries no canary (skip the
 * check and behave as before). Any malformation or tamper reads as `false`, the
 * same fail-closed verdict as a wrong key.
 */
export async function checkCanary(
  mk: CryptoKey,
  ks: Keystore,
): Promise<boolean | "absent"> {
  if (ks.v !== 2 || ks.canary_b64 === undefined) return "absent";
  try {
    await open(mk, fromB64url(ks.canary_b64), CANARY_CONTEXT);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// envelope seal / open
// ---------------------------------------------------------------------------

/**
 * The AEV2 additional-authenticated-data: the domain-separated storage path a v2
 * envelope binds. `"aev2\0" || path`, where the `"aev2"` label pins the version into
 * the tag (a v1 AAD is the four bytes `"AEV1"`, which these bytes can never equal) and
 * the NUL delimiter can't occur in a storage path — so the label is unambiguously
 * fenced off from the path, and no other (label, path) split can forge these bytes
 * (`"aev2" + "\0x"` can never equal `"aev2x" + "…"` once the NUL fixes the boundary,
 * so a path that merely starts with the label can't masquerade as the label itself).
 * The map path → these bytes is therefore injective: a fixed prefix followed by the
 * raw path, so distinct paths yield distinct AAD and a blob sealed for one address
 * fails the tag at any other. The meta isn't in the AAD (it stays sealed in the
 * payload and authenticated as plaintext under the same tag) because it isn't known
 * until after decryption, so it can't be a reconstructible input to open's AAD; the
 * envelope still binds the (meta, path) pair — meta through the payload, path through
 * here, both under one GCM tag.
 */
function contextBytes(context: string): Uint8Array {
  return new TextEncoder().encode("aev2\0" + context);
}

/** True iff `bytes` begins with every byte of `prefix`. */
function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * True if `bytes` begin with one of our sealed-envelope magics (AEV1 or AEV2).
 * The fixed-config PUT routes (fin/transit/todo/totp) use this as their frame
 * check: the server can never decrypt, but it can refuse anything that isn't one
 * of our envelopes. Accepting BOTH magics is load-bearing — a store may still hold
 * an old AEV1 blob while every new write is AEV2 (context-bound, ADR 0099), and a
 * check that only knew AEV1 would silently 404 every AEV2 write.
 */
export function hasAevMagic(bytes: Uint8Array): boolean {
  return startsWith(bytes, MAGIC_BYTES) || startsWith(bytes, MAGIC_V2_BYTES);
}

/**
 * meta + plaintext → one self-describing ciphertext envelope (the stored blob).
 *
 * With no `context`, this is AEV1 byte-for-byte — the magic is the only AAD — so every
 * existing caller and every stored blob is untouched. Pass the storage path as
 * `context` (including `""`, an explicit empty context) and it becomes an AEV2
 * envelope: the AAD is the domain-separated path, so the tag also proves WHERE the blob
 * lives and a swapped or relocated ciphertext fails to open like a tampered one.
 */
export async function seal(
  mk: CryptoKey,
  meta: EnvelopeMeta,
  bytes: Uint8Array,
  context?: string,
): Promise<Uint8Array> {
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const payload = new Uint8Array(4 + header.length + bytes.length);
  new DataView(payload.buffer).setUint32(0, header.length);
  payload.set(header, 4);
  payload.set(bytes, 4 + header.length);

  // context omitted → v1 (aad = the bare magic); context given → v2 (aad = the
  // domain-separated path). Both magics are 4 bytes, so the frame offsets are shared.
  const v2 = context !== undefined;
  const magicBytes = v2 ? MAGIC_V2_BYTES : MAGIC_BYTES;
  const aad = v2 ? contextBytes(context) : MAGIC_BYTES;

  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
      },
      mk,
      payload as BufferSource,
    ),
  );

  const out = new Uint8Array(magicBytes.length + IV_LEN + ct.length);
  out.set(magicBytes, 0);
  out.set(iv, magicBytes.length);
  out.set(ct, magicBytes.length + IV_LEN);
  return out;
}

/**
 * envelope → { meta, bytes }. Throws on anything that isn't a well-formed envelope
 * sealed under `mk`: bad magic, truncation, a flipped ciphertext byte, or a header
 * that doesn't parse. Callers treat any throw as "not decryptable".
 *
 * Dispatches on the magic. AEV1 authenticates the magic alone, so `context` is IGNORED
 * for a v1 blob — it predates contexts, and demanding one would break every stored
 * envelope. AEV2 binds the storage path, so the caller MUST re-supply the path the blob
 * was fetched from: a missing path is a programming error thrown before any crypto, and
 * a WRONG path fails the tag exactly like a tampered byte.
 */
export async function open(
  mk: CryptoKey,
  envelope: Uint8Array,
  context?: string,
): Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }> {
  const minLen = MAGIC_BYTES.length + IV_LEN + 16; // + GCM tag (both magics are 4 bytes)
  if (envelope.length < minLen) throw new Error("envelope: truncated");

  const v2 = startsWith(envelope, MAGIC_V2_BYTES);
  if (!v2 && !startsWith(envelope, MAGIC_BYTES))
    throw new Error("envelope: bad magic");

  let aad: Uint8Array;
  if (v2) {
    if (context === undefined)
      throw new Error("envelope: v2 envelope needs its storage path");
    aad = contextBytes(context);
  } else {
    aad = MAGIC_BYTES;
  }

  const iv = envelope.subarray(MAGIC_BYTES.length, MAGIC_BYTES.length + IV_LEN);
  const ct = envelope.subarray(MAGIC_BYTES.length + IV_LEN);
  // GCM authenticates ct + AAD here; tampering anywhere throws.
  const payload = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
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

// ---------------------------------------------------------------------------
// anonymous sealed box (ASB1) — write-only encryption to a published public key
// ---------------------------------------------------------------------------
//
// A sealed box lets ANYONE holding only the recipient's public point encrypt a
// message the recipient alone can open — the sender keeps nothing, and two
// encryptions of the same plaintext never collide. The financial-snapshot cron
// used this to write history it couldn't read; the encrypted drop box uses the
// same primitive so a stranger's browser can leave a message the server can't
// read. The recipient's static keypair is generated in-browser: the public point
// is published, the private half is sealed under the master key.

/**
 * A fresh ECDH P-256 keypair, extractable ONLY so both halves can be exported right
 * here: the public point as raw bytes (65B, published) and the private key as PKCS#8
 * (to be sealed under the MK before storage). The caller discards both handles after
 * export and re-imports the private half non-extractable.
 */
export async function generateBoxKeypair(): Promise<{
  pubRaw: Uint8Array;
  privPkcs8: Uint8Array;
}> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const pubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const privPkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  return { pubRaw, privPkcs8 };
}

/** Import a raw (65-byte uncompressed) P-256 point as an ECDH public key. */
export function importBoxPub(pubRaw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    pubRaw as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

/**
 * Import a PKCS#8 private key as a NON-extractable ECDH key usable only to derive
 * bits — the only form the app holds after unsealing. It can never be re-exported.
 */
export function importBoxPriv(privPkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    privPkcs8 as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

/**
 * ECDH(priv, pub) → HKDF-SHA256 → one AES-256-GCM key. Both raw public points ride
 * in the HKDF info (magic || eph || recipient): a swapped or tampered ephemeral, or
 * a wrong recipient, derives a different key and the GCM tag fails closed — the info
 * binding is what authenticates the handshake, since a sealed box has no signature.
 * salt is 32 zero bytes: ECDH already gives fresh, unique input material per message,
 * so HKDF needs no separate salt.
 */
async function deriveBoxKey(
  priv: CryptoKey,
  pub: CryptoKey,
  info: Uint8Array,
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pub },
    priv,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", bits, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32) as BufferSource,
      info: info as BufferSource,
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** info = "ASB1" || ephPubRaw(65) || recipientPubRaw(65) — binds both points into the KDF. */
function boxInfo(
  ephPubRaw: Uint8Array,
  recipientPubRaw: Uint8Array,
): Uint8Array {
  const info = new Uint8Array(BOX_MAGIC_BYTES.length + BOX_PUB_LEN * 2);
  info.set(BOX_MAGIC_BYTES, 0);
  info.set(ephPubRaw, BOX_MAGIC_BYTES.length);
  info.set(recipientPubRaw, BOX_MAGIC_BYTES.length + BOX_PUB_LEN);
  return info;
}

/**
 * Encrypt `bytes` TO a recipient's public key with nothing to keep on the sender's
 * side — the write-only channel a stranger's browser uses to seal a drop-box message
 * it can never reopen. A fresh ephemeral keypair per call means the same plaintext
 * never yields the same envelope, and the ephemeral private half is dropped once the
 * key derives.
 */
export async function boxSeal(
  recipientPubRaw: Uint8Array,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const recipientPub = await importBoxPub(recipientPubRaw);
  // extractable:false — only the PUBLIC half needs exporting (always allowed);
  // the ephemeral private key never gets even the theoretical ability to leave.
  const eph = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const ephPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", eph.publicKey),
  );

  const key = await deriveBoxKey(
    eph.privateKey,
    recipientPub,
    boxInfo(ephPubRaw, recipientPubRaw),
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: BOX_MAGIC_BYTES as BufferSource,
      },
      key,
      bytes as BufferSource,
    ),
  );

  const out = new Uint8Array(
    BOX_MAGIC_BYTES.length + BOX_PUB_LEN + IV_LEN + ct.length,
  );
  out.set(BOX_MAGIC_BYTES, 0);
  out.set(ephPubRaw, BOX_MAGIC_BYTES.length);
  out.set(iv, BOX_MAGIC_BYTES.length + BOX_PUB_LEN);
  out.set(ct, BOX_MAGIC_BYTES.length + BOX_PUB_LEN + IV_LEN);
  return out;
}

/**
 * Reopen a sealed box with the recipient's private key. Throws a plain Error on any
 * malformation or tamper — short buffer, bad magic, an ephemeral point that isn't on
 * the curve, or a failed GCM tag — and never reads past the declared regions. The
 * recipient's own public point is passed back in to rebuild the exact HKDF info the
 * sender used; a mismatch there fails the tag like any other tamper.
 */
export async function boxOpen(
  priv: CryptoKey,
  recipientPubRaw: Uint8Array,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  const minLen = BOX_MAGIC_BYTES.length + BOX_PUB_LEN + IV_LEN + 16; // + GCM tag
  if (envelope.length < minLen) throw new Error("box: truncated");
  for (let i = 0; i < BOX_MAGIC_BYTES.length; i++) {
    if (envelope[i] !== BOX_MAGIC_BYTES[i]) throw new Error("box: bad magic");
  }

  const ephStart = BOX_MAGIC_BYTES.length;
  const ivStart = ephStart + BOX_PUB_LEN;
  const ctStart = ivStart + IV_LEN;
  const ephPubRaw = envelope.subarray(ephStart, ivStart);
  const iv = envelope.subarray(ivStart, ctStart);
  const ct = envelope.subarray(ctStart);

  const ephPub = await importBoxPub(ephPubRaw);
  const key = await deriveBoxKey(
    priv,
    ephPub,
    boxInfo(ephPubRaw, recipientPubRaw),
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: BOX_MAGIC_BYTES as BufferSource,
      },
      key,
      ct as BufferSource,
    ),
  );
}
