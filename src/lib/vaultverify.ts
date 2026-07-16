/**
 * vaultverify — the pure unlock-time integrity check for the E2EE vault (ADR:
 * integrity manifest). E2EE gives confidentiality and AEV gives per-blob
 * tamper-proofing, but neither notices a blob that silently VANISHES, one swapped
 * for its own older valid ciphertext, or a whole store rolled back to last month —
 * everything still decrypts, so nothing complains. The manifest (a Merkle record
 * vault-sync seals over every vault blob, `lib/merkle`) closes that: this module
 * compares what the server actually served against what the manifest committed to,
 * and returns NAMED problems, never a silent nothing.
 *
 * Pure — no I/O, no store imports — so it runs in the reader island and in
 * Node-vitest unchanged. The caller fetches + decrypts the manifest and the index,
 * hashes the served index envelope, and reads the device's epoch memory
 * (`keycache.getSeenEpoch`); this module only judges.
 */

import { compareEpoch, verifyManifest, type VaultManifest } from "./merkle";
import {
  imageBlob,
  noteBlob,
  VAULT_INDEX_PATH,
  VAULT_SEARCH_INDEX_PATH,
  type VaultIndex,
} from "./vaultblob";

export interface IntegrityResult {
  status: "verified" | "alarm";
  /** The served manifest's epoch — on "verified" the caller persists it as the
   *  device's new high-water mark (`keycache.bumpSeenEpoch`). */
  epoch: number;
  /** Human-readable, blob-NAMED findings; empty exactly when verified. */
  problems: string[];
}

/** Every stored path the index implies must exist — the notes, the images, the
 *  index itself, and the search index (both rewritten every sync). The manifest
 *  is deliberately absent: it cannot contain its own hash. */
export function expectedVaultPaths(index: VaultIndex): string[] {
  return [
    VAULT_INDEX_PATH,
    VAULT_SEARCH_INDEX_PATH,
    ...index.notes.map((n) => noteBlob(n.id)),
    ...index.images.map((i) => imageBlob(i.id)),
  ];
}

/** The manifest's recorded envelope hash for one stored path, or null when the
 *  path isn't recorded — the reader's lazy per-blob check. */
export function manifestHashFor(m: VaultManifest, path: string): string | null {
  return m.entries.find((e) => e.path === path)?.h ?? null;
}

/** "n-… is `<title>`" — alarms should name notes, not opaque blob ids. Falls back
 *  to the raw path for anything the index can't name (including the index itself). */
function nameFor(index: VaultIndex, path: string): string {
  for (const n of index.notes) if (noteBlob(n.id) === path) return n.title;
  for (const i of index.images) if (imageBlob(i.id) === path) return i.name;
  return path;
}

/** Cap a name list so one mass-deletion doesn't render a thousand-line alarm. */
function nameList(index: VaultIndex, paths: string[], cap = 5): string {
  const names = paths.slice(0, cap).map((p) => nameFor(index, p));
  const more = paths.length - names.length;
  return names.join(", ") + (more > 0 ? ` — and ${more} more` : "");
}

/**
 * The unlock-time judgement. Four independent checks, all of which must hold:
 *
 * 1. The manifest's root recomputes from its own entries (a manifest edited
 *    after sealing fails here even though its AEV tag was valid when written).
 * 2. The served epoch is not older than the highest this device has verified —
 *    an older epoch IS the rollback signal (the store can serve a fully
 *    self-consistent old snapshot; only device memory catches it).
 * 3. The served index envelope hashes to what the manifest recorded for it.
 * 4. The index and the manifest agree on WHICH blobs exist, both directions —
 *    a vanished blob or a resurrected deleted one is named, not shrugged at.
 *
 * Detection only — repair is a different trust decision and never automatic.
 */
export async function checkVaultIntegrity(args: {
  manifest: VaultManifest;
  index: VaultIndex;
  /** b64url SHA-256 of the index envelope bytes AS SERVED (pre-decrypt). */
  indexEnvelopeHash: string;
  /** The device's epoch high-water mark; null = first verification (trusted). */
  seenEpoch: number | null;
}): Promise<IntegrityResult> {
  const { manifest, index, indexEnvelopeHash, seenEpoch } = args;
  const problems: string[] = [];

  if (!(await verifyManifest(manifest)))
    problems.push(
      "manifest root does not match its entries — the manifest was altered after sealing",
    );

  if (compareEpoch(seenEpoch, manifest.epoch) === "rolled-back")
    problems.push(
      `store rolled back — served epoch ${manifest.epoch}, but this device has verified epoch ${seenEpoch}`,
    );

  const recordedIndexHash = manifestHashFor(manifest, VAULT_INDEX_PATH);
  if (recordedIndexHash === null)
    problems.push("the manifest does not record the note index at all");
  else if (recordedIndexHash !== indexEnvelopeHash)
    problems.push("the note index ciphertext does not match the manifest");

  const expected = new Set(expectedVaultPaths(index));
  const recorded = new Set(manifest.entries.map((e) => e.path));
  const unrecorded = [...expected].filter((p) => !recorded.has(p));
  const vanished = [...recorded].filter((p) => !expected.has(p));
  if (unrecorded.length > 0)
    problems.push(
      `${unrecorded.length} blob(s) the index lists are missing from the manifest: ${nameList(index, unrecorded)}`,
    );
  if (vanished.length > 0)
    problems.push(
      `${vanished.length} recorded blob(s) are no longer listed by the index: ${nameList(index, vanished)}`,
    );

  return {
    status: problems.length === 0 ? "verified" : "alarm",
    epoch: manifest.epoch,
    problems,
  };
}
