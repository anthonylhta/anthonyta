/**
 * hub-decrypt — the owner-run counterpart to `npm run hub-backup`: it turns one
 * dated backup folder into PLAINTEXT on disk, readable with no site, no bucket and
 * no network at all. The backup deliberately holds nothing but ciphertext and
 * involves no passphrase (`lib/backup`), which makes it a safe off-site copy and an
 * unreadable one — until now the only way to read a backup was to restore it into
 * the hub and unlock there. This is the other door: the answer to "what if the site
 * is gone", and the reason the estate is worth backing up at all.
 *
 * Sibling of `scripts/hub-backup.ts` in structure (`console.error` for progress so
 * stdout carries only the summary, fail-fast on the first bad row, the index written
 * LAST so a partial folder can never look complete) with one difference: nothing
 * here talks to R2 — not even the keystore, which is read from the folder's own
 * copy. So the npm script needs neither `--env-file` nor the IPv4-first flags its
 * siblings carry; it needs only tsx.
 *
 * What it does, once per run:
 *   1. Shape-guard `<backup-dir>/manifest.json`, find the folder's keystore, and
 *      refuse an out dir that already exists — ALL of it before asking for the
 *      passphrase, because none of those mistakes is worth typing a secret for.
 *   2. Unwrap the master key from `<backup-dir>/meta/keystore`, off disk.
 *   3. Per manifest row: verify the file's sha256 first (a corrupted backup must
 *      never produce silent garbage), then act on `planRow`'s verdict — open the
 *      envelope, copy plaintext-by-design state through, pass the dropbox key record
 *      through sealed, or leave an unclassified key alone.
 *   4. Write `index.json`, then say — loudly — what is now sitting on the disk.
 *
 * Run: `npm run hub-decrypt -- <backup-dir> [--out <dir>]`.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  backupKeyToRelPath,
  isManifest,
  type BackupManifest,
} from "../src/lib/backup";
import {
  fromB64url,
  isKeystore,
  normalizeKeystore,
  open,
  unwrapMk,
  type Keystore,
} from "../src/lib/crypto";
import { plainOutPath, planRow } from "../src/lib/decrypt";
import { formatSize } from "../src/lib/files";
import { deriveKekForKdf } from "../src/lib/kdf";

/** One exported row, as `index.json` records it. Nothing ever reads this file back
 *  — it is the export's receipt for a human — so it needs no shape guard. */
interface IndexRow {
  key: string;
  action: "decrypted" | "copied" | "sealed" | "unclassified";
  /** The sealed metadata, for decrypted rows: original name, MIME type, size. */
  n?: string;
  t?: string;
  s?: number;
  /** Why a row was copied rather than opened (the classifier's own words). */
  reason?: string;
  /** Where the bytes landed, relative to the out dir. Absent = nothing written. */
  path?: string;
}

// ---------------------------------------------------------------------------
// the backup folder (read + guarded before anything is asked for or written)
// ---------------------------------------------------------------------------

/**
 * Read and shape-guard the folder's manifest. Same guard the restore path applies
 * to the same file, for the same reason: every row below trusts these fields.
 */
async function loadManifest(dir: string): Promise<BackupManifest> {
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
  return parsed;
}

/**
 * The wrapped master key, from the BACKUP's own `meta/keystore` — never from the
 * store. A backup that can only be read while the bucket answers would defeat the
 * whole exercise. Read and validated before the prompt so a folder missing its
 * keystore costs an error, not a passphrase.
 */
async function loadKeystore(dir: string): Promise<Keystore> {
  const file = path.join(dir, "meta", "keystore");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(
      `${file} is missing — this folder has no keystore, so nothing in it can be opened`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  if (!isKeystore(json)) throw new Error(`${file} is not a valid keystore`);
  return normalizeKeystore(json);
}

/**
 * Passphrase → master key. The wrong-passphrase check is the GCM unwrap failing,
 * exactly as everywhere else in the hub: there is no verifier to consult.
 */
async function unwrapMasterKey(
  ks: Keystore,
  passphrase: string,
): Promise<CryptoKey> {
  const kek = await deriveKekForKdf(ks.kdf, passphrase);
  try {
    return await unwrapMk(
      fromB64url(ks.wrapped_mk_b64),
      fromB64url(ks.iv_b64),
      kek,
    );
  } catch {
    throw new Error("wrong passphrase");
  }
}

// ---------------------------------------------------------------------------
// hidden passphrase prompt (verbatim from scripts/aperture-sync.ts, which is
// itself verbatim vault-sync — the copy IS the precedent: these scripts share no
// runtime module, and a shared prompt helper would be an abstraction over three
// call sites that have never once needed to differ)
// ---------------------------------------------------------------------------

/**
 * Read a passphrase without echoing it: take the TTY into raw mode and consume
 * bytes directly. Raw mode means the terminal driver echoes nothing, and we decide
 * what each byte does (Enter resolves, backspace edits, Ctrl-C aborts) — readline
 * with a muted sink hangs on WSL, which is why vault-sync stopped using it.
 */
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(query);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl-C — restore the terminal before dying
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    stdin.on("data", onData);
  });
}

/** VAULT_PASSPHRASE wins (non-interactive); otherwise a hidden TTY prompt. It is
 *  the same keystore as the vault's, so it is the same env var — a second name for
 *  one passphrase would only invite the two to drift. */
async function readPassphrase(): Promise<string> {
  const fromEnv = process.env.VAULT_PASSPHRASE;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY)
    throw new Error(
      "no interactive terminal — set VAULT_PASSPHRASE for a non-interactive run",
    );
  const pass = await promptHidden("Vault passphrase: ");
  if (!pass) throw new Error("empty passphrase");
  return pass;
}

// ---------------------------------------------------------------------------
// the export
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Write one file under the out dir, creating the directories it needs. */
async function writeOut(
  outDir: string,
  rel: string,
  bytes: Uint8Array,
): Promise<void> {
  const dest = path.join(outDir, ...rel.split("/"));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
}

async function decrypt(dir: string, outDir: string): Promise<void> {
  // Everything that can be judged without a secret is judged first.
  const manifest = await loadManifest(dir);
  const ks = await loadKeystore(dir);
  if (await exists(outDir))
    throw new Error(
      `${outDir} already exists — refusing to write plaintext over it; remove it or pass --out <dir>`,
    );

  const mk = await unwrapMasterKey(ks, await readPassphrase());
  console.error(
    `· unlocked the backup's own keystore (${manifest.count} rows)`,
  );

  const rows: IndexRow[] = [];
  const unclassified: string[] = [];
  const counts = { decrypted: 0, copied: 0, sealed: 0, unclassified: 0 };
  let written = 0;

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
    // Hash BEFORE decrypting: a corrupt backup must abort naming the key, never
    // quietly export half an estate beside a file that opened into garbage.
    if (sha256Hex(bytes) !== e.sha256)
      throw new Error(
        `sha256 mismatch for ${e.key} — corrupt file or wrong manifest, aborting`,
      );

    const plan = planRow(e.key);
    if (plan.action === "decrypt" || plan.action === "decrypt-manifest") {
      // The manifest opens exactly as the vault reader opens it — AEV1, no
      // context — which is the contextless case of the same call.
      const context = plan.action === "decrypt" ? plan.context : undefined;
      let opened;
      try {
        opened = await open(mk, bytes, context);
      } catch (err) {
        throw new Error(
          `${e.key} would not open (${err instanceof Error ? err.message : String(err)}) — ` +
            `export INCOMPLETE, index NOT written; remove ${outDir} and investigate`,
        );
      }
      const out = plainOutPath(e.key, opened.meta.n);
      await writeOut(outDir, out, opened.bytes);
      rows.push({
        key: e.key,
        action: "decrypted",
        n: opened.meta.n,
        t: opened.meta.t,
        s: opened.meta.s,
        path: out,
      });
      counts.decrypted++;
      written += opened.bytes.length;
      console.error(`  ${i}/${manifest.count}: ${e.key} → ${out}`);
    } else if (plan.action === "copy") {
      await writeOut(outDir, rel, bytes);
      rows.push({
        key: e.key,
        action: "copied",
        reason: plan.reason,
        path: rel,
      });
      counts.copied++;
      written += bytes.length;
      console.error(`  ${i}/${manifest.count}: ${e.key} (copied — plaintext)`);
    } else if (plan.action === "sealed") {
      // The dropbox key record rides through as it is: its private half stays
      // MK-sealed inside the JSON, and the public half is public by design. This
      // is a DATA export — no key material is ever written in the clear.
      await writeOut(outDir, rel, bytes);
      rows.push({ key: e.key, action: "sealed", path: rel });
      counts.sealed++;
      written += bytes.length;
      console.error(
        `  ${i}/${manifest.count}: ${e.key} (copied — still sealed)`,
      );
    } else {
      unclassified.push(e.key);
      rows.push({ key: e.key, action: "unclassified" });
      counts.unclassified++;
      console.error(
        `  ${i}/${manifest.count}: ${e.key} (UNCLASSIFIED — skipped)`,
      );
    }
  }

  // The index goes last, like the backup's manifest: a folder without one is a
  // run that died, and says so by its absence.
  await fs.writeFile(
    path.join(outDir, "index.json"),
    JSON.stringify(
      { v: 1, created: new Date().toISOString(), source: dir, rows },
      null,
      2,
    ),
  );

  console.log(
    `decrypted ${counts.decrypted} · copied ${counts.copied} · sealed ${counts.sealed} · ` +
      `unclassified ${counts.unclassified} — ${formatSize(written)} written`,
  );
  if (unclassified.length > 0) {
    console.log(
      `left sealed — unclassified (${unclassified.length}): ${unclassified.join(", ")}`,
    );
    console.log(
      "classify them in src/lib/rotationset.ts to include them in the next export",
    );
  }
  console.log(
    `PLAINTEXT on disk at ${outDir} — every sealed store is readable here; delete the folder when done.`,
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  let out: string | undefined;
  if (outIdx !== -1) {
    const value = args[outIdx + 1];
    if (!value || value.startsWith("--"))
      throw new Error("--out requires a directory: --out <dir>");
    out = value;
    args.splice(outIdx, 2);
  }
  const dir = args[0];
  if (!dir || dir.startsWith("--"))
    throw new Error("usage: npm run hub-decrypt -- <backup-dir> [--out <dir>]");

  const backupDir = path.resolve(dir);
  await decrypt(backupDir, out ? path.resolve(out) : `${backupDir}-plain`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
