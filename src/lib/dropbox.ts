/**
 * Pure helpers + types for the encrypted drop box — a stranger's browser seals a
 * message to the owner's published public key (ADR: sealed box, resurrected), so the
 * server stores ciphertext it can never read and the owner decrypts it in the command
 * center. No `next`, store, or Node-only import, so this layer is safe in the public
 * contact page's client bundle AND unit-testable on its own (mirrors lib/files).
 *
 * Three fixed paths:
 *   - `meta/dropboxkey` — the owner's box keypair record (public point + MK-sealed
 *     private half). The PUBLIC half is served openly so any visitor can encrypt; the
 *     private half only opens behind the passphrase.
 *   - `dropbox/<id>.bin` — one sealed message. Opaque; only the owner can open it.
 */

export const DROPBOX_PREFIX = "dropbox/";
export const DROPBOX_KEY_PATH = "meta/dropboxkey";

/** The plaintext body cap (generous for a note, tight enough to bound abuse). */
export const MAX_BODY_CHARS = 2000;
/** An optional "how to reach you back" line — an email, a handle, whatever. */
export const MAX_CONTACT_CHARS = 200;
/** The stored ciphertext envelope cap the ingest route enforces before any write. */
export const MAX_ENVELOPE_BYTES = 8192;

/** The owner's published box keypair record (public point + MK-sealed private half). */
export interface DropboxKey {
  v: 1;
  alg: "ECDH-P256";
  pub_b64: string;
  sealed_priv_b64: string;
}

/** The plaintext payload a visitor seals — never seen by the server. */
export interface DropMessage {
  v: 1;
  body: string;
  contact?: string;
  /** ISO timestamp stamped on the sender's device (advisory — the server can't verify it). */
  at: string;
}

/** Strict shape guard for the stored key record (server serve-gate + client parse). */
export function isDropboxKey(x: unknown): x is DropboxKey {
  if (typeof x !== "object" || x === null) return false;
  const k = x as Record<string, unknown>;
  return (
    k.v === 1 &&
    k.alg === "ECDH-P256" &&
    typeof k.pub_b64 === "string" &&
    k.pub_b64.length > 0 &&
    k.pub_b64.length <= 120 &&
    typeof k.sealed_priv_b64 === "string" &&
    k.sealed_priv_b64.length > 0 &&
    k.sealed_priv_b64.length <= 4096
  );
}

/** Strict shape guard for a decrypted message (the owner validates after opening). */
export function isDropMessage(x: unknown): x is DropMessage {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    m.v === 1 &&
    typeof m.body === "string" &&
    (m.contact === undefined || typeof m.contact === "string") &&
    typeof m.at === "string"
  );
}

export type MessageError = "empty" | "too-long" | "contact-too-long";

/**
 * Validate a composed message on the SENDER side, before sealing. Trims, enforces the
 * caps, and returns the canonical `DropMessage` to seal — or an error the form shows.
 * `now` is injected so the timestamp is testable.
 */
export function buildMessage(
  body: string,
  contact: string,
  now: string,
): { ok: true; message: DropMessage } | { ok: false; error: MessageError } {
  const b = body.trim();
  const c = contact.trim();
  if (b.length === 0) return { ok: false, error: "empty" };
  if (b.length > MAX_BODY_CHARS) return { ok: false, error: "too-long" };
  if (c.length > MAX_CONTACT_CHARS)
    return { ok: false, error: "contact-too-long" };
  const message: DropMessage = { v: 1, body: b, at: now };
  if (c.length > 0) message.contact = c;
  return { ok: true, message };
}

/** Traversal/probe guard for a STORED drop path — the only shape the owner serves. */
export function isValidDropPath(p: string): boolean {
  if (
    typeof p !== "string" ||
    !p.startsWith(DROPBOX_PREFIX) ||
    p.includes("..")
  )
    return false;
  return /^[A-Za-z0-9_-]{1,64}\.bin$/.test(p.slice(DROPBOX_PREFIX.length));
}

/** `dropbox/<id>.bin` for a random id (the sender never chooses a meaningful name). */
export function dropPath(id: string): string {
  return `${DROPBOX_PREFIX}${id}.bin`;
}
