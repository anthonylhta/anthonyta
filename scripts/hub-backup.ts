/**
 * hub-backup — the owner-run bridge that mirrors the hub's private R2 estate to a
 * local, dated folder (roadmap item 36). The keystore, fin envelope, inbox files,
 * webauthn record, PRF wraps, analytics, and the synced vault have NO copy outside
 * R2 — a July 2026 store suspension proved that failure class — and every one of
 * them is ciphertext or non-secret metadata, so a plain local copy is safe on any
 * disk. NO passphrase is involved: this only moves opaque bytes, it never decrypts.
 *
 * Two modes, sibling in spirit to `scripts/vault-sync.ts` (same tsx invocation,
 * same IPv4-first flags, same `lib/r2` reuse, `console.error` for progress so
 * stdout carries only the final summary):
 *
 *   backup (default): refuse unless the store is on, list `meta/`, `inbox/`,
 *     `vault/` (all pages; `share/` is skipped by never listing it — ephemeral),
 *     download each object, write it under `notes/misc/backups/<YYYY-MM-DD>/<key>`,
 *     sha256 it, then write `manifest.json`. Any download failure aborts non-zero
 *     naming the key and does NOT write the manifest, so a partial folder can never
 *     look complete.
 *
 *   restore (`--restore <dir> --yes`): read + shape-guard the folder's manifest,
 *     then for each row read the local file, verify its sha256, confirm the key is
 *     under a backed-up prefix, and PUT it back (overwrite — writeKey is idempotent,
 *     so a re-run after a mid-restore abort is safe). Fail fast on any mismatch. The
 *     `--yes` flag is required because a restore overwrites live objects; without it
 *     the plan is printed and nothing is written.
 *
 * Run: `npm run hub-backup` / `npm run hub-backup -- --restore <dir> --yes`. The
 * npm script loads `.env.local` for the `R2_*` vars, passes tsx as a loader, and
 * pins `--dns-result-order=ipv4first --no-network-family-autoselection` — on WSL2
 * the dual-stack host's dead IPv6 + Node's Happy Eyeballs stalls every fetch
 * otherwise (the same trap as the dev/build/vault-sync scripts).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  backupKeyToRelPath,
  BACKUP_PREFIXES,
  buildManifest,
  isManifest,
  restoreKeyAllowed,
  type BackupEntry,
} from "../src/lib/backup";
import { formatSize } from "../src/lib/files";
import {
  r2Enabled,
  r2Get,
  r2List,
  writeKey,
  type R2ListedObject,
} from "../src/lib/r2";

const STORE_OFF =
  "R2 store is off — check .env.local (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
  "R2_SECRET_ACCESS_KEY, R2_BUCKET)";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Local calendar day, `YYYY-MM-DD` — the dated backup folder's name. */
function localDateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Every object under one prefix, following the continuation token to the last page. */
async function listPrefix(prefix: string): Promise<R2ListedObject[]> {
  const out: R2ListedObject[] = [];
  let token: string | undefined;
  do {
    const page = await r2List(prefix, token); // throws on failure → aborts the run
    out.push(...page.objects);
    token = page.next;
  } while (token);
  return out;
}

/** Fully read one object's bytes; a non-2xx or transport throw propagates to the caller. */
async function download(key: string): Promise<Uint8Array> {
  const res = await r2Get(key);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------

async function backup(): Promise<void> {
  if (!r2Enabled()) throw new Error(STORE_OFF);

  const backupDir = path.resolve(
    process.cwd(),
    "notes/misc/backups",
    localDateStamp(new Date()),
  );
  if (await exists(backupDir))
    throw new Error(
      `${backupDir} already exists — a same-day re-run would mix two snapshots; remove it first`,
    );

  console.error("· listing the store…");
  const objects: R2ListedObject[] = [];
  for (const prefix of BACKUP_PREFIXES)
    objects.push(...(await listPrefix(prefix)));
  console.error(
    `· ${objects.length} objects to back up (share/ skipped — ephemeral)`,
  );

  // Download → write → hash each object, collecting manifest rows. A failure here
  // aborts BEFORE the manifest is written, so the folder is visibly incomplete.
  const entries: BackupEntry[] = [];
  let i = 0;
  for (const obj of objects) {
    i++;
    const rel = backupKeyToRelPath(obj.key);
    if (!rel)
      throw new Error(`refusing an unsafe key from the store: ${obj.key}`);

    let bytes: Uint8Array;
    try {
      bytes = await download(obj.key);
    } catch (err) {
      throw new Error(
        `download failed for ${obj.key} (${err instanceof Error ? err.message : String(err)}) — ` +
          `backup INCOMPLETE, manifest NOT written; remove ${backupDir} and retry`,
      );
    }

    const dest = path.join(backupDir, ...rel.split("/"));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes);
    entries.push({
      key: obj.key,
      size: bytes.length,
      sha256: sha256Hex(bytes),
    });
    console.error(
      `  ${i}/${objects.length}: ${obj.key} (${formatSize(bytes.length)})`,
    );
  }

  if (entries.length !== objects.length)
    throw new Error(
      `wrote ${entries.length} files but listed ${objects.length} — backup INCOMPLETE, manifest NOT written`,
    );

  const manifest = buildManifest(entries, new Date().toISOString());
  await fs.writeFile(
    path.join(backupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  console.log(
    `backed up ${manifest.count} objects, ${formatSize(manifest.totalBytes)} → ${backupDir}`,
  );
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

async function restore(dir: string, yes: boolean): Promise<void> {
  if (!r2Enabled()) throw new Error(STORE_OFF);

  const manifestPath = path.join(dir, "manifest.json");
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch {
    throw new Error(
      `no readable manifest.json in ${dir} — not a backup folder?`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${manifestPath} is not valid JSON`);
  }
  if (!isManifest(parsed))
    throw new Error(`${manifestPath} is not a valid backup manifest`);
  const manifest = parsed;

  console.error(
    `Restore: ${manifest.count} objects from ${dir} → the R2 bucket (OVERWRITES live objects).`,
  );
  if (!yes) {
    console.error("Nothing written. Re-run with --yes to perform the restore.");
    return;
  }

  // Per row: verify the local file against the manifest hash and confirm the key is
  // in-bounds BEFORE writing. Any mismatch aborts — a half-verified restore stops.
  let i = 0;
  for (const e of manifest.entries) {
    i++;
    const rel = backupKeyToRelPath(e.key);
    if (!rel) throw new Error(`manifest has an unsafe key: ${e.key}`);

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(
        await fs.readFile(path.join(dir, ...rel.split("/"))),
      );
    } catch {
      throw new Error(`missing backup file for ${e.key} in ${dir}`);
    }
    if (sha256Hex(bytes) !== e.sha256)
      throw new Error(
        `sha256 mismatch for ${e.key} — corrupt file or wrong manifest, aborting`,
      );
    if (!restoreKeyAllowed(e.key))
      throw new Error(
        `refusing to restore a key outside ${BACKUP_PREFIXES.join(", ")}: ${e.key}`,
      );

    const wrote = await writeKey(e.key, bytes, {
      overwrite: true,
      contentType: "application/octet-stream",
    });
    if (wrote !== "ok") throw new Error(`write failed for ${e.key}: ${wrote}`);
    console.error(
      `  ${i}/${manifest.count}: ${e.key} (${formatSize(bytes.length)})`,
    );
  }

  console.log(`restored ${manifest.count} objects from ${dir} → the R2 bucket`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const restoreIdx = args.indexOf("--restore");
  if (restoreIdx !== -1) {
    const dir = args[restoreIdx + 1];
    if (!dir || dir.startsWith("--"))
      throw new Error("--restore requires a directory: --restore <dir> --yes");
    await restore(path.resolve(dir), args.includes("--yes"));
  } else {
    await backup();
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
