/**
 * The passkey credential record — the ONLY server-side auth state, one small
 * JSON at `meta/webauthn` in the private blob store (the keystore/snapkey
 * pattern; no database, ADR 0054's deletion stays deleted). Everything in it
 * is non-secret single-user data: credential IDs and PUBLIC keys, transports,
 * sign counters, plus the sha256 hash of the one-time recovery code. Multiple
 * credentials (phone + laptop + backup hardware key) live in one record.
 *
 * Pure module: types, the shape guard, and immutable mutations. Blob I/O lives
 * in store.ts; verification in verify.ts.
 */

export const WEBAUTHN_PATH = "meta/webauthn";
export const WEBAUTHN_MAX_BYTES = 8192;
export const MAX_CREDS = 12;

export interface WebauthnCred {
  /** base64url credential ID, as the authenticator reports it. */
  id: string;
  /** base64url COSE public key bytes. */
  pk: string;
  /**
   * Last seen signature counter — telemetry, never a gate: synced passkeys
   * (iCloud Keychain, Google Password Manager) report 0 forever, so a
   * regression must not read as a cloned authenticator and lock the owner out.
   */
  counter: number;
  transports?: string[];
  /** Owner-facing device name, lowercase ("iphone", "yubikey"). */
  label: string;
  createdAt: string;
}

export interface WebauthnRecord {
  v: 1;
  creds: WebauthnCred[];
  /** sha256 of the one-time recovery code, minted at first enrollment. */
  recovery?: { hash_b64: string; createdAt: string };
}

function isCred(x: unknown): x is WebauthnCred {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    c.id.length > 0 &&
    c.id.length <= 200 &&
    typeof c.pk === "string" &&
    c.pk.length > 0 &&
    c.pk.length <= 2000 &&
    typeof c.counter === "number" &&
    Number.isInteger(c.counter) &&
    c.counter >= 0 &&
    (c.transports === undefined ||
      (Array.isArray(c.transports) &&
        c.transports.length <= 8 &&
        c.transports.every(
          (t) => typeof t === "string" && t.length > 0 && t.length <= 32,
        ))) &&
    typeof c.label === "string" &&
    c.label.length > 0 &&
    c.label.length <= 64 &&
    typeof c.createdAt === "string" &&
    c.createdAt.length <= 40
  );
}

/** Shape check for anything claiming to be the record (store parse + route gate). */
export function isWebauthnRecord(x: unknown): x is WebauthnRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  if (r.v !== 1) return false;
  if (!Array.isArray(r.creds) || r.creds.length > MAX_CREDS) return false;
  if (!r.creds.every(isCred)) return false;
  if (r.recovery !== undefined) {
    if (typeof r.recovery !== "object" || r.recovery === null) return false;
    const rec = r.recovery as Record<string, unknown>;
    if (
      typeof rec.hash_b64 !== "string" ||
      rec.hash_b64.length <= 20 ||
      rec.hash_b64.length > 64 ||
      typeof rec.createdAt !== "string" ||
      rec.createdAt.length > 40
    ) {
      return false;
    }
  }
  return true;
}

export function newRecord(): WebauthnRecord {
  return { v: 1, creds: [] };
}

/** Append a credential; null on a duplicate id or a full record. */
export function appendCred(
  rec: WebauthnRecord,
  cred: WebauthnCred,
): WebauthnRecord | null {
  if (rec.creds.length >= MAX_CREDS) return null;
  if (rec.creds.some((c) => c.id === cred.id)) return null;
  return { ...rec, creds: [...rec.creds, cred] };
}

/** Store a new counter on the matching credential (no-op on unknown id). */
export function withCounter(
  rec: WebauthnRecord,
  credId: string,
  counter: number,
): WebauthnRecord {
  return {
    ...rec,
    creds: rec.creds.map((c) => (c.id === credId ? { ...c, counter } : c)),
  };
}

export function withRecovery(
  rec: WebauthnRecord,
  hash_b64: string,
  createdAt: string,
): WebauthnRecord {
  return { ...rec, recovery: { hash_b64, createdAt } };
}

/** Consume the one-time recovery code (single-use: the hash is dropped). */
export function withoutRecovery(rec: WebauthnRecord): WebauthnRecord {
  return { v: rec.v, creds: rec.creds };
}
