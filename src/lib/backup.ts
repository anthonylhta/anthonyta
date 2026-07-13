/**
 * backup — pure helpers + the manifest shape for `npm run hub-backup`, the
 * owner-run script that mirrors the private R2 estate (keystore, fin envelope,
 * inbox files, webauthn record, PRF wraps, analytics, synced vault) to a local
 * dated folder. Everything in the estate is ciphertext or non-secret metadata, so
 * a local copy is safe on any disk and NO passphrase is involved anywhere.
 *
 * The reason this layer exists apart from the script: the restore path parses a
 * `manifest.json` off disk and then writes each row's bytes BACK into the bucket.
 * That manifest is untrusted input — a corrupted or hand-edited one must not be
 * able to steer a write outside the backup dir (on read) or land a key outside the
 * known prefixes (on write). So the shape guard (`isManifest`), the traversal-safe
 * key→path mapping (`backupKeyToRelPath`), and the restore allow-list
 * (`restoreKeyAllowed`) are all here, dependency-free (no node:crypto, no fs — the
 * script owns I/O and hashing) and unit-tested in isolation, exactly like
 * `lib/files`.
 */

/** Prefixes the backup captures; `share/` is deliberately omitted (ephemeral). */
export const BACKUP_PREFIXES = ["meta/", "inbox/", "vault/"] as const;

/** One backed-up object: its R2 key, byte length, and lowercase-hex SHA-256. */
export interface BackupEntry {
  key: string;
  size: number;
  sha256: string;
}

/** The dated folder's `manifest.json`. `v` gates future format changes. */
export interface BackupManifest {
  v: 1;
  /** ISO-8601 time the backup was taken. */
  created: string;
  count: number;
  totalBytes: number;
  entries: BackupEntry[];
}

/** SHA-256 as the manifest records it: exactly 64 lowercase hex chars. */
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Map an R2 key to a safe relative path under the backup dir. Keys the app writes
 * match `[A-Za-z0-9._/-]` and use `/` as the separator; anything else — a stray
 * byte, a `..` or `.` segment, an empty segment (which also catches a leading or
 * trailing `/`), or a non-string — returns null so a hostile manifest can neither
 * escape the backup dir on read nor target a bucket key it shouldn't on write.
 */
export function backupKeyToRelPath(key: unknown): string | null {
  if (typeof key !== "string" || key.length === 0) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) return null;
  const segments = key.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return null;
  }
  return segments.join("/");
}

/**
 * Restore only ever writes keys under the backed-up prefixes. A prefix match is
 * necessary but not sufficient — the restore path pairs this with
 * `backupKeyToRelPath` so `meta/../evil` (prefix-OK but traversal) is still refused.
 */
export function restoreKeyAllowed(key: string): boolean {
  return BACKUP_PREFIXES.some((p) => key.startsWith(p));
}

function isBackupEntry(x: unknown): x is BackupEntry {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.key === "string" &&
    e.key.length > 0 &&
    typeof e.size === "number" &&
    Number.isInteger(e.size) &&
    e.size >= 0 &&
    typeof e.sha256 === "string" &&
    SHA256_RE.test(e.sha256)
  );
}

/**
 * Strict shape guard for a manifest read off disk. Guards every field's type and
 * that `count` matches the entry count (a truncated file fails), so the restore
 * loop can trust the rows it iterates.
 */
export function isManifest(x: unknown): x is BackupManifest {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  if (m.v !== 1) return false;
  if (typeof m.created !== "string" || m.created.length === 0) return false;
  if (typeof m.count !== "number" || !Number.isInteger(m.count) || m.count < 0)
    return false;
  if (
    typeof m.totalBytes !== "number" ||
    !Number.isInteger(m.totalBytes) ||
    m.totalBytes < 0
  )
    return false;
  if (!Array.isArray(m.entries)) return false;
  if (!m.entries.every(isBackupEntry)) return false;
  return m.entries.length === m.count;
}

/** Assemble a manifest, deriving `count`/`totalBytes` so they can't disagree with the rows. */
export function buildManifest(
  entries: BackupEntry[],
  created: string,
): BackupManifest {
  return {
    v: 1,
    created,
    count: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
    entries,
  };
}
