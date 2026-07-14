/**
 * vault-sync — the owner-run bridge that pushes the local Obsidian vault into the
 * hub's private R2 bucket as END-TO-END-ENCRYPTED blobs (ADR 0053's E2EE model,
 * extended to the vault by ADR 0059; storage on R2 since ADR 0060). Nothing here
 * is a secret and it lives in the public repo, exactly like `src/lib/crypto.ts`:
 * the R2 credentials and the passphrase arrive at runtime from the environment /
 * an interactive prompt, never from the file.
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
 * in the owner's browser with the same MK. Reuses `src/lib/crypto.ts`,
 * `src/lib/vaultblob.ts`, and `src/lib/r2.ts` verbatim (all Node-safe) via
 * RELATIVE imports so `tsx` needs no path-alias mapping.
 *
 * Run: `npm run vault-sync -- <VAULT_DIR>` (or set VAULT_DIR). The npm script
 * loads `.env.local` for the `R2_*` vars, passes tsx as a loader, and pins
 * `--dns-result-order=ipv4first --no-network-family-autoselection` — on WSL2 the
 * dual-stack host's dead IPv6 + Node's Happy Eyeballs stalls every fetch
 * otherwise (the same trap as the repo-wide dev/build scripts).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  deriveKek,
  fromB64url,
  isKeystore,
  open,
  seal,
  toB64url,
  unwrapMk,
} from "../src/lib/crypto";
import { r2Delete, r2Enabled, r2List, r2Put, readKey } from "../src/lib/r2";
import {
  buildIndex,
  indexStats,
  serializeIndex,
  type IndexDoc,
} from "../src/lib/searchidx";
import {
  deriveId,
  imageBlob,
  isVaultIndex,
  noteBlob,
  notePreview,
  VAULT_INDEX_PATH,
  VAULT_PREFIX,
  VAULT_SEARCH_INDEX_PATH,
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
// store helpers (the R2 credentials are read from the env by src/lib/r2)
// ---------------------------------------------------------------------------

/**
 * Fully read one object's bytes; null when the key is genuinely absent. A
 * transport failure or a misconfigured bucket ABORTS the run instead — treating
 * either as "absent" would kick off a needless full re-upload (prior index) or a
 * misleading setup message (keystore).
 */
async function getBytes(key: string): Promise<Uint8Array | null> {
  const read = await readKey(key);
  if (read.state === "ok") return read.value;
  if (read.state === "absent") return null;
  throw new Error(`reading ${key} failed — check the R2_* env vars / network`);
}

/** Upload one sealed envelope, overwriting whatever id it lands on. */
async function putEnvelope(key: string, envelope: Uint8Array): Promise<void> {
  const res = await r2Put(key, envelope, {
    contentType: "application/octet-stream",
  });
  if (!res.ok) throw new Error(`uploading ${key} failed: HTTP ${res.status}`);
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
 * Read a passphrase without echoing it: take the TTY into raw mode and consume
 * bytes directly. The previous readline-with-a-discarding-sink approach hung on
 * WSL — readline never surfaced the Enter keypress through the muted output — so
 * this skips readline entirely: raw mode means the terminal driver echoes
 * nothing, and we decide what each byte does (Enter resolves, backspace edits,
 * Ctrl-C aborts).
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
// full-text search index (character trigrams)
// ---------------------------------------------------------------------------

/**
 * Build and upload the sealed trigram full-text index. Tokenizing the whole vault is
 * near-instant (no model), so this rebuilds from scratch every run — no reuse map, no
 * drift class — and seals the opaque bytes under the MK exactly like every other blob.
 * The browser decrypts + queries it entirely client-side.
 */
async function buildAndUploadSearchIndex(
  mk: CryptoKey,
  notes: WalkedNote[],
): Promise<void> {
  const docs: IndexDoc[] = notes.map((note) => ({
    id: note.id,
    title: note.name.replace(/\.md$/i, ""),
    text: new TextDecoder().decode(note.bytes),
  }));
  const index = buildIndex(docs);
  const searchBytes = serializeIndex(index);
  const envelope = await seal(
    mk,
    {
      n: "search-index",
      t: "application/octet-stream",
      s: searchBytes.length,
    },
    searchBytes,
  );
  const stats = indexStats(index);
  console.error(
    `· writing the search index (${stats.docs} notes, ${stats.tokens} trigrams, ${searchBytes.length} bytes)…`,
  );
  await putEnvelope(VAULT_SEARCH_INDEX_PATH, envelope);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!r2Enabled())
    throw new Error(
      "R2 store is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY, and R2_BUCKET (loaded from .env.local via --env-file)",
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
  console.error("· unlocked the vault key");

  // 2. the prior index doubles as the manifest — id → hash of the last upload
  const priorH = await loadPriorHashes(mk);
  console.error(`· prior index: ${priorH.size} entries`);

  // 3. walk the vault (reads + hashes every file)
  const { notes, images } = await walkVault(root);
  console.error(`· found ${notes.length} notes, ${images.length} images`);

  // 4. seal + upload only what changed; build the fresh index rows as we go
  let uploaded = 0;

  const indexNotes: VaultIndexNote[] = [];
  for (const note of notes) {
    const title = note.name.replace(/\.md$/i, "");
    const preview = notePreview(new TextDecoder().decode(note.bytes));
    if (priorH.get(note.id) !== note.h) {
      console.error(
        `  note ${indexNotes.length + 1}/${notes.length}: uploading ${title}`,
      );
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
      console.error(
        `  image ${indexImages.length + 1}/${images.length}: uploading ${image.name}`,
      );
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
  console.error("· writing the index…");
  await putEnvelope(VAULT_INDEX_PATH, indexEnvelope);

  // 5b. build + seal the trigram full-text index. Rebuilt from scratch each run
  // (tokenizing the vault is cheap) and decrypted + queried entirely in the browser.
  await buildAndUploadSearchIndex(mk, notes);

  console.error("· pruning stale blobs…");

  // 6. prune blobs no longer backed by a file. Uploads → index → prune, so a run
  // that dies before this leaves stale blobs the NEXT run cleans up (self-healing).
  const keep = new Set<string>([VAULT_INDEX_PATH, VAULT_SEARCH_INDEX_PATH]);
  for (const n of indexNotes) keep.add(noteBlob(n.id));
  for (const i of indexImages) keep.add(imageBlob(i.id));

  let pruned = 0;
  let token: string | undefined;
  do {
    const page = await r2List(VAULT_PREFIX, token);
    for (const o of page.objects) {
      if (!keep.has(o.key)) {
        await r2Delete(o.key);
        pruned++;
      }
    }
    token = page.next;
  } while (token);

  console.log(
    `synced: ${notes.length} notes, ${images.length} images (${uploaded} uploaded, ${pruned} pruned)`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
