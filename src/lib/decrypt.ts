/**
 * decrypt — pure helpers for `npm run hub-decrypt`, the owner-run script that turns
 * one `hub-backup` folder into plaintext on disk. The backup is deliberately opaque
 * (ciphertext only, no passphrase anywhere — `lib/backup`), which makes it a safe
 * off-site copy and an unreadable one: today the only way to read it is to restore
 * it into the hub and unlock there. This layer is what lets a folder be read with
 * no site at all.
 *
 * Both functions are decisions, not I/O — the script owns node:fs, the hashing and
 * the WebCrypto calls, exactly as `lib/backup` splits from `scripts/hub-backup`. So
 * the export's whole policy (what happens to each family of keys, and where each
 * plaintext lands) is unit-testable without a bucket, a passphrase or a disk.
 *
 * The estate map is NOT re-derived here: `planRow` reads `classifyKey`, the
 * fail-closed classifier the MK rotation already refuses to run without
 * (`lib/rotationset`). One map, two consumers — a store added without classifying
 * it blocks the rotation AND lands in this export's "left sealed" list, instead of
 * being quietly skipped by a second hand-maintained list that nobody kept current.
 */

import { classifyKey } from "./rotationset";

/**
 * What the export does with one backed-up key — the rotation's verdicts read
 * through the export's lens:
 *  - `decrypt` — an MK-sealed envelope; `context` is the AAD path for the fixed
 *    AEV2 stores, absent for the AEV1 vault/inbox blobs (so an AEV2 blob in a
 *    contextless family fails to open LOUDLY rather than being written out wrong).
 *  - `decrypt-manifest` — the vault integrity manifest, opened the way the vault
 *    reader opens it (AEV1, no context). Named apart from `decrypt` because the
 *    rotation treats it apart: it is rebuilt there, merely read here.
 *  - `copy` — plaintext hub state by design; the bytes pass through and the
 *    classifier's reason rides into the index, so the export shows its work.
 *  - `sealed` — the dropbox key record. This is a DATA export: the record's
 *    MK-sealed private half stays sealed, and the public half is public anyway.
 *  - `unclassified` — refuse to guess. The rotation refuses to run over one of
 *    these; the export leaves it sealed and says so.
 */
export type PlainRow =
  | { action: "decrypt"; context?: string }
  | { action: "decrypt-manifest" }
  | { action: "copy"; reason: string }
  | { action: "sealed" }
  | { action: "unclassified" };

/** Map one estate key onto its export action. Total, like `classifyKey` itself. */
export function planRow(key: string): PlainRow {
  const verdict = classifyKey(key);
  if (verdict.action === "skip")
    return { action: "copy", reason: verdict.reason };
  if (verdict.action === "unknown") return { action: "unclassified" };
  if (verdict.kind === "manifest") return { action: "decrypt-manifest" };
  if (verdict.kind === "dropboxkey") return { action: "sealed" };
  return verdict.context === undefined
    ? { action: "decrypt" }
    : { action: "decrypt", context: verdict.context };
}

/**
 * A name safe to write to disk: the printable subset the sealed metadata actually
 * carries (filenames, `fin.json`, `manifest`), with no separator of either kind and
 * no length a filesystem would argue with.
 */
const SAFE_NAME_RE = /^[A-Za-z0-9._ -]{1,120}$/;

/**
 * Where one decrypted envelope's plaintext lands, relative to the out dir:
 * `<key minus one trailing .bin>/<name>`. The key becomes a DIRECTORY so the
 * sealed filename can be restored beside it — `vault/n-<id>.bin` is opaque, and
 * `journal/2026-08-01.md` inside it is the whole point of the export.
 *
 * The sealed name is attacker-influenced in exactly one place (an inbox item is
 * named by whoever uploaded it), so it is used only when it is a plain leaf name;
 * anything else — a separator, a traversal segment, an empty or oversized name —
 * falls back to `payload`. The key half is already traversal-safe: every row
 * passed `backupKeyToRelPath` before reaching here.
 */
export function plainOutPath(key: string, metaName: string): string {
  const dir = key.endsWith(".bin") ? key.slice(0, -".bin".length) : key;
  const safe =
    SAFE_NAME_RE.test(metaName) && metaName !== "." && metaName !== ".."
      ? metaName
      : "payload";
  return `${dir}/${safe}`;
}
