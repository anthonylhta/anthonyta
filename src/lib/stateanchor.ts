/**
 * State anchors — rollback detection for the key-material records, riding the
 * auth journal (58b's layered flavor; extends ADR 0086/0087 thinking to the
 * stores where rollback has real teeth).
 *
 * The threat: a storage-level attacker can't forge ciphertext, but can serve
 * STALE state — an old `meta/keystore` resurrects a changed-away passphrase, an
 * old `meta/prfwrap` resurrects a revoked device's tap-unlock. Rollback undoes
 * revocations.
 *
 * The trick: every write to those records is ALREADY journaled in the
 * hash-chained auth log (ADR 0087), and devices already keep a tamper-evident
 * tip memory that catches journal rollback/rewrite. So the write's journal
 * entry gains a content hash of the state it produced — riding INSIDE the
 * `detail` string, so the chain format doesn't change and pre-feature entries
 * simply read as "unanchored". The browser then verifies hash(served record)
 * against the NEWEST journal event of that kind:
 *
 *   - roll back the record alone  → anchor mismatch, named here;
 *   - roll back the journal too   → the existing tip alarm fires;
 *   - edit a past event's anchor  → the chain breaks at that entry.
 *
 * BYTE-EQUALITY INVARIANT: the anchor is a hash of the exact JSON string the
 * server persisted. The reader re-derives it from what the route serves — the
 * keystore GET returns the stored string verbatim; the prf GET re-serializes
 * the parsed set, which is byte-stable because both sides stringify the same
 * key-ordered shape (pinned by test). Anchor with `anchorHash(json)` on the
 * string actually written, never on a re-parse.
 *
 * Pure module: crypto.subtle only (the lib/authlog discipline) — runs in the
 * window, a worker, and Node-vitest.
 */

import type { AuthEntry, AuthEventKind } from "./authlog";
import { toB64url } from "./crypto";

/** Marker splitting a human detail from its anchor. The middle dot matches the
 *  journal's existing detail idiom; parsing keys off the full marker string. */
export const ANCHOR_MARK = " · state:";

/** 96-bit truncation of SHA-256, b64url — far beyond accidental collision at
 *  journal scale, compact enough to ride every event's detail string. */
const ANCHOR_CHARS = 16;

/** Hash a persisted record's exact JSON text into its anchor. */
export async function anchorHash(json: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return toB64url(new Uint8Array(digest)).slice(0, ANCHOR_CHARS);
}

/** Append an anchor to a journal detail string. */
export function withAnchor(detail: string, anchor: string): string {
  return `${detail}${ANCHOR_MARK}${anchor}`;
}

/** The anchor riding a detail string, or null for a pre-feature entry. Strict:
 *  the marker must be followed by exactly the anchor at the string's end. */
export function parseAnchor(detail: string): string | null {
  const at = detail.lastIndexOf(ANCHOR_MARK);
  if (at === -1) return null;
  const anchor = detail.slice(at + ANCHOR_MARK.length);
  return /^[A-Za-z0-9_-]{16}$/.test(anchor) ? anchor : null;
}

/**
 * The newest journal entry of one of `kinds`, scanned from the tail. Returns
 * null when no such event exists (nothing has ever written the record — e.g. a
 * pre-passkey journal with no prf events). The newest event is the ONLY one a
 * current record may be compared against: matching an older anchor is exactly
 * what a rollback looks like.
 */
export function newestEventOf(
  entries: AuthEntry[],
  kinds: readonly AuthEventKind[],
): AuthEntry | null {
  for (let i = entries.length - 1; i >= 0; i--)
    if (kinds.includes(entries[i].kind)) return entries[i];
  return null;
}

export type AnchorVerdict =
  /** hash(served record) matches the newest event's anchor. */
  | "verified"
  /** The served record does NOT match what the journal says was last written —
   *  a rollback or substitution, assuming the chain itself verified. */
  | "mismatch"
  /** The newest event predates anchoring — nothing to compare until the next
   *  legitimate write of that record. Honest absence, not a pass. */
  | "unanchored";

/** Compare a served record's anchor against the newest event's. */
export function anchorVerdict(
  servedAnchor: string,
  newestEvent: AuthEntry | null,
): AnchorVerdict {
  if (newestEvent === null) return "unanchored";
  const recorded = parseAnchor(newestEvent.detail);
  if (recorded === null) return "unanchored";
  return recorded === servedAnchor ? "verified" : "mismatch";
}

/** The kinds whose newest event anchors each record. */
export const KEYSTORE_KINDS: readonly AuthEventKind[] = ["keystore"];
export const PRF_KINDS: readonly AuthEventKind[] = ["prf-add", "prf-remove"];
