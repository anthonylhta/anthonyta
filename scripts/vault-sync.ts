/**
 * vault-sync — the owner-run bridge that pushes the local Obsidian vault into the
 * hub's private blob store as END-TO-END-ENCRYPTED blobs (ADR 0053's E2EE model,
 * extended to the vault). Nothing here is a secret and it lives in the public repo,
 * exactly like `src/lib/crypto.ts`: the blob token and the passphrase arrive at
 * runtime from the environment / an interactive prompt, never from the file.
 *
 * What it does, once per run:
 *   1. Unwrap the master key (MK) from `meta/keystore` with the owner's passphrase —
 *      the same keystore the files inbox created. A wrong passphrase fails the GCM
 *      unwrap, which IS the passphrase check (crypto.ts has no separate verifier).
 *   2. Read the PRIOR encrypted index and remember each item's content hash. The
 *      index doubles as the sync manifest — there is no separate state file — so a
 *      note/image is re-sealed and re-uploaded ONLY when its bytes changed.
 *   3. Walk the vault, seal every changed note/image under the MK, upload the
 *      changed ones, rewrite the index, then prune blobs no longer backed by a file.
 *
 * The hub therefore only ever stores ciphertext under `vault/`; decryption happens
 * in the owner's browser with the same MK. Reuses `src/lib/crypto.ts` and
 * `src/lib/vaultblob.ts` verbatim (both pure and Node-safe) via RELATIVE imports so
 * `tsx` needs no path-alias mapping.
 *
 * Run: `npm run vault-sync -- <VAULT_DIR>` (or set VAULT_DIR). The npm script loads
 * `.env.local` for BLOB_READ_WRITE_TOKEN and passes tsx as a loader.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import { Writable } from "node:stream";

import { del, get, list, put } from "@vercel/blob";

import {
  deriveKek,
  fromB64url,
  isKeystore,
  open,
  seal,
  toB64url,
  unwrapMk,
} from "../src/lib/crypto";
import {
  deriveId,
  imageBlob,
  isVaultIndex,
  noteBlob,
  notePreview,
  VAULT_INDEX_PATH,
  VAULT_PREFIX,
  type VaultIndex,
  type VaultIndexImage,
  type VaultIndexNote,
} from "../src/lib/vaultblob";

// Image extensions the vault reader knows how to render, → their MIME type. Any
// other extension (and anything without one) is ignored by the walk.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  heic: "image/heic",
};

/** A vault file discovered by the walk, with its bytes and content hash. */
interface WalkedFile {
  id: string;
  /** vault-relative POSIX path, NFC-normalized. */
  path: string;
  /** the file's basename (with extension). */
  name: string;
  bytes: Uint8Array;
  /** base64url(SHA-256(bytes)) — the idempotency key. */
  h: string;
}

interface WalkedNote extends WalkedFile {
  /** mtime as an ISO string. */
  modified: string;
}

interface WalkedImage extends WalkedFile {
  /** lowercased extension, without the dot. */
  ext: string;
}

// ---------------------------------------------------------------------------
// blob helpers (drain a private GET; the token is read from the env by @vercel/blob)
// ---------------------------------------------------------------------------

/** Fully read a private blob's stream to bytes; null when the blob is absent. */
async function getBytes(pathname: string): Promise<Uint8Array | null> {
  const res = await get(pathname, { access: "private" });
  if (!res || res.statusCode !== 200) return null;
  const reader = res.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Upload one sealed envelope, overwriting whatever id it lands on. */
function putEnvelope(pathname: string, envelope: Uint8Array): Promise<unknown> {
  return put(pathname, new Blob([envelope as BlobPart]), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/octet-stream",
  });
}

// ---------------------------------------------------------------------------
// key + prior-index loading
// ---------------------------------------------------------------------------

/**
 * Unwrap the MK from `meta/keystore`. A malformed/absent keystore aborts with a
 * clear message; a wrong passphrase makes `unwrapMk` throw on the GCM tag, which we
 * translate to "wrong passphrase".
 */
async function unwrapMasterKey(passphrase: string): Promise<CryptoKey> {
  const bytes = await getBytes("meta/keystore");
  if (!bytes)
    throw new Error(
      "meta/keystore not found — set up the encryption key in the files inbox first",
    );
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("meta/keystore is not valid JSON");
  }
  if (!isKeystore(json))
    throw new Error("meta/keystore is not a valid keystore");

  const kek = await deriveKek(
    passphrase,
    fromB64url(json.kdf.salt_b64),
    json.kdf.iterations,
  );
  try {
    return await unwrapMk(
      fromB64url(json.wrapped_mk_b64),
      fromB64url(json.iv_b64),
      kek,
    );
  } catch {
    throw new Error("wrong passphrase");
  }
}

/**
 * The prior index is the sync manifest: id → content hash for every note and image
 * it recorded. Absent or undecryptable → an empty map, so the next run treats every
 * file as new and re-uploads it (correct, just not incremental).
 */
async function loadPriorHashes(mk: CryptoKey): Promise<Map<string, string>> {
  const prior = new Map<string, string>();
  const envelope = await getBytes(VAULT_INDEX_PATH);
  if (!envelope) return prior;
  try {
    const { bytes } = await open(mk, envelope);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isVaultIndex(parsed)) return prior;
    for (const n of parsed.notes) if (n.h) prior.set(n.id, n.h);
    for (const i of parsed.images) if (i.h) prior.set(i.id, i.h);
  } catch {
    // corrupt/legacy index → fall back to a full re-upload
  }
  return prior;
}

// ---------------------------------------------------------------------------
// walk
// ---------------------------------------------------------------------------

/**
 * Recursively collect the vault's notes (`.md`) and images. Skips `.obsidian`,
 * `.trash`, and any other dotfile directory (config/state, never content).
 */
async function walkVault(
  root: string,
): Promise<{ notes: WalkedNote[]; images: WalkedImage[] }> {
  const notes: WalkedNote[] = [];
  const images: WalkedImage[] = [];

  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === ".obsidian" ||
          entry.name === ".trash" ||
          entry.name.startsWith(".")
        )
          continue;
        await recurse(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).slice(1).toLowerCase();
      const isNote = ext === "md";
      const isImage = ext in IMAGE_MIME;
      if (!isNote && !isImage) continue;

      const rel = path
        .relative(root, full)
        .split(path.sep)
        .join("/")
        .normalize("NFC");
      const name = entry.name.normalize("NFC");
      const bytes = new Uint8Array(await fs.readFile(full));
      const h = toB64url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      );
      const id = await deriveId(rel);

      if (isNote) {
        const stat = await fs.stat(full);
        notes.push({
          id,
          path: rel,
          name,
          bytes,
          h,
          modified: stat.mtime.toISOString(),
        });
      } else {
        images.push({ id, path: rel, name, bytes, h, ext });
      }
    }
  }

  await recurse(root);
  return { notes, images };
}

// ---------------------------------------------------------------------------
// hidden passphrase prompt
// ---------------------------------------------------------------------------

/**
 * Read a passphrase without echoing it. The prompt itself is written straight to
 * stdout; readline's key echoes are routed through a Writable that DISCARDS every
 * byte (the whole point), so nothing typed — nor the trailing newline — is shown.
 * `terminal: true` is required so readline takes raw-mode control of the input TTY
 * instead of letting the terminal driver echo the keystrokes itself.
 */
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    process.stdout.write(query);
    const rl = readline.createInterface({
      input: process.stdin,
      output: sink,
      terminal: true,
    });
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** VAULT_PASSPHRASE wins (non-interactive/CI); otherwise a hidden TTY prompt. */
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
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is required (load .env.local via --env-file)",
    );
  const vaultDir = process.env.VAULT_DIR ?? process.argv[2];
  if (!vaultDir)
    throw new Error("VAULT_DIR is required (env var or first argument)");
  const root = path.resolve(vaultDir);
  if (!(await fs.stat(root)).isDirectory())
    throw new Error(`VAULT_DIR is not a directory: ${root}`);

  const passphrase = await readPassphrase();

  // 1. unwrap the master key (wrong passphrase throws here)
  const mk = await unwrapMasterKey(passphrase);

  // 2. the prior index doubles as the manifest — id → hash of the last upload
  const priorH = await loadPriorHashes(mk);

  // 3. walk the vault (reads + hashes every file)
  const { notes, images } = await walkVault(root);

  // 4. seal + upload only what changed; build the fresh index rows as we go
  let uploaded = 0;

  const indexNotes: VaultIndexNote[] = [];
  for (const note of notes) {
    const title = note.name.replace(/\.md$/i, "");
    const preview = notePreview(new TextDecoder().decode(note.bytes));
    if (priorH.get(note.id) !== note.h) {
      const envelope = await seal(
        mk,
        { n: title, t: "text/markdown", s: note.bytes.length },
        note.bytes,
      );
      await putEnvelope(noteBlob(note.id), envelope);
      uploaded++;
    }
    indexNotes.push({
      id: note.id,
      title,
      path: note.path,
      modified: note.modified,
      preview,
      h: note.h,
    });
  }

  const indexImages: VaultIndexImage[] = [];
  for (const image of images) {
    if (priorH.get(image.id) !== image.h) {
      const envelope = await seal(
        mk,
        {
          n: image.name,
          t: IMAGE_MIME[image.ext] ?? "application/octet-stream",
          s: image.bytes.length,
        },
        image.bytes,
      );
      await putEnvelope(imageBlob(image.id), envelope);
      uploaded++;
    }
    indexImages.push({
      id: image.id,
      name: image.name,
      path: image.path,
      h: image.h,
    });
  }

  // 5. rewrite the index — notes NEWEST-FIRST so the reader's duplicate-title
  // first-wins resolves to the most recently modified note (matches getVaultIndex)
  indexNotes.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  const index: VaultIndex = { v: 1, notes: indexNotes, images: indexImages };
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  const indexEnvelope = await seal(
    mk,
    { n: "index", t: "application/json", s: indexBytes.length },
    indexBytes,
  );
  await putEnvelope(VAULT_INDEX_PATH, indexEnvelope);

  // 6. prune blobs no longer backed by a file. Uploads → index → prune, so a run
  // that dies before this leaves stale blobs the NEXT run cleans up (self-healing).
  const keep = new Set<string>([VAULT_INDEX_PATH]);
  for (const n of indexNotes) keep.add(noteBlob(n.id));
  for (const i of indexImages) keep.add(imageBlob(i.id));

  let pruned = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: VAULT_PREFIX, cursor });
    for (const blob of page.blobs) {
      if (!keep.has(blob.pathname)) {
        await del(blob.pathname);
        pruned++;
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  console.log(
    `synced: ${notes.length} notes, ${images.length} images (${uploaded} uploaded, ${pruned} pruned)`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
