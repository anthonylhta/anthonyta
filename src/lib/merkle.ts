/**
 * Pure Merkle-tree core for the vault integrity manifest — a client-built,
 * master-key-sealed proof that the sealed `vault/*` blobs the R2 store serves are
 * exactly the set the owner last wrote. E2EE hides the plaintext, but the server
 * could still silently DELETE a blob, corrupt one, or roll the whole bucket back to
 * an old snapshot — every remaining envelope would still decrypt, so nothing would
 * look wrong. The manifest closes that gap: `{path, h}` per blob (h = hash of the
 * ENVELOPE bytes as served), folded into one root; a monotonic `epoch` counter that
 * each device remembers defeats rollback (same trick as certificate transparency).
 *
 * No store and no `next` import, no Node-only APIs — only `crypto.subtle` — so this
 * layer runs unchanged in the window, a worker, and Node-vitest, and is unit-testable
 * on its own (mirrors lib/vaultblob + lib/crypto).
 */

import { toB64url } from "./crypto";

export interface ManifestEntry {
  /** The stored blob pathname (e.g. `vault/n-<id>.bin`). */
  path: string;
  /** b64url(SHA-256(envelope bytes)) — the ciphertext AS SERVED, so a corrupted or
   *  swapped blob no longer matches without touching (or being able to read) the
   *  plaintext. */
  h: string;
}

export interface VaultManifest {
  v: 1;
  /** Monotonic write counter, >= 1. A served epoch older than the highest a device
   *  has verified means the store was rolled back (see compareEpoch). */
  epoch: number;
  /** b64url Merkle root over the entries (order-independent — see buildRoot). */
  root: string;
  /** Must equal entries.length — a cheap tamper check independent of the root. */
  count: number;
  entries: ManifestEntry[];
}

// Domain-separation prefixes. Hashing a leaf and an interior node through the SAME
// SHA-256 with DIFFERENT, disjoint prefixes means an attacker can never present an
// interior node's two 32-byte children as if they were a leaf's (path, h) pair, nor
// vice versa — the classic Merkle second-preimage attack. The trailing NUL inside
// the leaf ALSO separates path from h so `{path:"a b", h:"c"}` and
// `{path:"a", h:"b c"}` can never fold to the same digest.
const LEAF_PREFIX = "leaf\0";
const NODE_PREFIX = new TextEncoder().encode("node\0");
const EMPTY_PREFIX = "empty\0";

/** b64url(SHA-256(bytes)) — the entry hash callers compute over envelope bytes. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  return toB64url(await sha256(bytes));
}

/** Raw 32-byte SHA-256 digest, the internal folding currency. */
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
}

/**
 * Leaf digest for one entry: SHA-256("leaf\0" ‖ path ‖ "\0" ‖ h). String
 * concatenation before encoding IS byte concatenation of the UTF-8 forms, so this is
 * exactly utf8("leaf\0") ‖ utf8(path) ‖ utf8("\0") ‖ utf8(h). The NUL between path
 * and h keeps the two fields unconfusable.
 */
async function leafHash(e: ManifestEntry): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(LEAF_PREFIX + e.path + "\0" + e.h));
}

/**
 * Interior node: SHA-256("node\0" ‖ left32 ‖ right32) over the RAW 32-byte child
 * digests. The "node\0" prefix (disjoint from "leaf\0") is what makes a node
 * uncounterfeitable as a leaf.
 */
async function nodeHash(
  left: Uint8Array,
  right: Uint8Array,
): Promise<Uint8Array> {
  const buf = new Uint8Array(NODE_PREFIX.length + left.length + right.length);
  buf.set(NODE_PREFIX, 0);
  buf.set(left, NODE_PREFIX.length);
  buf.set(right, NODE_PREFIX.length + left.length);
  return sha256(buf);
}

/**
 * Merkle root over the entries, order-independent: entries are sorted by path (plain
 * `<` string compare) before folding, so the same set in any input order yields the
 * same root. An odd node at any level is carried up UNPAIRED (never duplicated —
 * duplicating a last node enables a known forgery). The empty list has a defined,
 * stable root, b64url(SHA-256("empty\0")), distinct from any single leaf.
 */
export async function buildRoot(entries: ManifestEntry[]): Promise<string> {
  if (entries.length === 0) {
    return hashBytes(new TextEncoder().encode(EMPTY_PREFIX));
  }
  const sorted = [...entries].sort(byPath);
  let level: Uint8Array[] = [];
  for (const e of sorted) level.push(await leafHash(e));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(
        i + 1 < level.length
          ? await nodeHash(level[i], level[i + 1])
          : level[i], // odd one out: carried up unpaired
      );
    }
    level = next;
  }
  return toB64url(level[0]);
}

/** Assemble a manifest: root + count computed from the entries (entries kept in the
 *  order given — the root is order-independent, so storage order is free). */
export async function buildManifest(
  entries: ManifestEntry[],
  epoch: number,
): Promise<VaultManifest> {
  return {
    v: 1,
    epoch,
    root: await buildRoot(entries),
    count: entries.length,
    entries,
  };
}

/**
 * Shape guard for a decrypted manifest (client parse). Required fields only, and
 * paths must be UNIQUE — a duplicate path would let two blobs claim the same slot,
 * so it's rejected outright. Extra unknown keys ride through untouched (forward-
 * compat, like isVaultIndex), so an older client never rejects a newer manifest.
 */
export function isManifest(x: unknown): x is VaultManifest {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  if (m.v !== 1) return false;
  if (typeof m.epoch !== "number" || !Number.isInteger(m.epoch) || m.epoch < 1)
    return false;
  if (typeof m.root !== "string") return false;
  if (!Array.isArray(m.entries) || m.count !== m.entries.length) return false;
  const seen = new Set<string>();
  for (const e of m.entries) {
    if (typeof e !== "object" || e === null) return false;
    const entry = e as Record<string, unknown>;
    if (typeof entry.path !== "string" || typeof entry.h !== "string")
      return false;
    if (seen.has(entry.path)) return false; // duplicate path
    seen.add(entry.path);
  }
  return true;
}

/** Recompute the root from the entries and compare — a manifest whose root doesn't
 *  match its own entries has been tampered with or corrupted in transit. */
export async function verifyManifest(m: VaultManifest): Promise<boolean> {
  return (await buildRoot(m.entries)) === m.root;
}

/**
 * Diff two entry sets by path: `missing` = in prior only (a blob the server dropped),
 * `added` = in current only, `changed` = present in both but the hash differs (a
 * corrupted or swapped blob). Each list sorted ascending for stable, reviewable
 * output.
 */
export function diffEntries(
  prior: ManifestEntry[],
  current: ManifestEntry[],
): { changed: string[]; missing: string[]; added: string[] } {
  const priorMap = new Map(prior.map((e) => [e.path, e.h]));
  const currentMap = new Map(current.map((e) => [e.path, e.h]));
  const changed: string[] = [];
  const missing: string[] = [];
  const added: string[] = [];
  for (const [path, h] of priorMap) {
    if (!currentMap.has(path)) missing.push(path);
    else if (currentMap.get(path) !== h) changed.push(path);
  }
  for (const path of currentMap.keys()) {
    if (!priorMap.has(path)) added.push(path);
  }
  return {
    changed: changed.sort(cmp),
    missing: missing.sort(cmp),
    added: added.sort(cmp),
  };
}

/**
 * Rollback check: a served epoch strictly older than the highest this device has
 * verified means the store was rolled back to a stale snapshot. A null `seen` is the
 * device's first sync — nothing to compare against, so we trust it by design (the
 * device pins the epoch it just saw and catches any later regression).
 */
export function compareEpoch(
  seen: number | null,
  served: number,
): "ok" | "rolled-back" {
  if (seen === null) return "ok";
  return served < seen ? "rolled-back" : "ok";
}

/**
 * Incremental manifest build for the sync script: for each currently-present path,
 * a fresh hash (recomputed this run) WINS; else the prior manifest's entry is carried
 * forward unchanged (unmodified blob, no need to re-fetch); else the path is unknown
 * to both and needs a backfill fetch to be hashed. Returns the resolvable entries in
 * `currentPaths` order plus the backfill list. Prior entries for paths no longer
 * present are dropped (a deleted blob leaves the manifest).
 */
export function carryForward(
  prior: VaultManifest | null,
  currentPaths: string[],
  freshHashes: Map<string, string>,
): { entries: ManifestEntry[]; backfill: string[] } {
  const priorMap = new Map((prior?.entries ?? []).map((e) => [e.path, e.h]));
  const entries: ManifestEntry[] = [];
  const backfill: string[] = [];
  for (const path of currentPaths) {
    const fresh = freshHashes.get(path);
    if (fresh !== undefined) {
      entries.push({ path, h: fresh });
      continue;
    }
    const carried = priorMap.get(path);
    if (carried !== undefined) entries.push({ path, h: carried });
    else backfill.push(path);
  }
  return { entries, backfill };
}

/** Plain `<` ascending string compare, the sort order for paths throughout. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Entry sort by path, for the order-independent fold. */
function byPath(a: ManifestEntry, b: ManifestEntry): number {
  return cmp(a.path, b.path);
}
