/**
 * aperture-sync — the owner-run bridge that seals the private status document into
 * the hub's R2 bucket. Sibling of `scripts/vault-sync.ts` in every structural way:
 * it lives in the public repo and holds no secret, the R2 credentials arrive from
 * the environment, and the passphrase from an interactive prompt.
 *
 * THE SCRIPT SEALS; IT NEVER ADJUDICATES. Curation happens entirely upstream —
 * `$APERTURE_DIR/aperture.json` is refreshed by the weekly check-in, and by the time
 * this runs every count, status and outcome in it is already settled. The site then
 * renders whatever this seals, so a wrong figure here is a wrong figure on the
 * homepage: nothing downstream recomputes it, and nothing in this script edits it.
 *
 * APERTURE_DIR points at the owner's local Aperture folder — the one holding
 * `aperture.json` — and stays outside the repo, which is why it is an env var and
 * not a checked-in path.
 *
 * What it does, once per run:
 *   1. Load and VALIDATE `aperture.json` against `normalizeAperture`, the same gate
 *      the browser applies on the way out. This happens before the passphrase is
 *      even asked for, and certainly before any write: a rejected document exits
 *      non-zero having touched nothing.
 *   2. Unwrap the master key (MK) from `meta/keystore` with the owner's passphrase —
 *      the same keystore the files inbox created, and the same wrong-passphrase-is-a-
 *      failed-GCM-unwrap check vault-sync relies on.
 *   3. Open the PREVIOUS envelope, if there is one — to archive and to diff against.
 *      A missing or unreadable prior reads as a first seal; that costs the summary
 *      and the archive, never the sync.
 *   4. ARCHIVE the prior at its dated history key (`meta/aperture-hist/<day>.bin`,
 *      day = the seal's Sydney calendar day, AAD = the dated key itself — the
 *      aevcontext family) BEFORE anything overwrites `meta/aperture`. Step 5
 *      destroys the only other copy of that document, so this write goes first and
 *      a failure aborts with nothing changed. This is what makes the weekly
 *      overwrite non-destructive: every seal survives at its date (ADR 0116).
 *   5. Write the two objects the render side reads:
 *        · `meta/aperture` — the AEV2 envelope (AAD = APERTURE_CONTEXT), whose
 *          plaintext is the whole document as JSON; the owner's browser opens it and
 *          re-validates with `normalizeAperture`.
 *        · `meta/aperture-glance.json` — the plaintext rank/stage/sealedAt glance the
 *          band draws before any unlock.
 *      Plain overwrites: this script is the store's SINGLE writer, so there is no
 *      no-clobber dance and no conflict to resolve.
 *   6. Archive THIS seal at its own dated key too, so the record carries the
 *      current week without waiting for the next run to treat it as the prior. A
 *      failure here self-heals: the next run archives this document in step 4.
 *
 * Run: `npm run aperture-sync` (with APERTURE_DIR set, or the folder as the first
 * argument). The npm script loads `.env.local` for the `R2_*` vars, passes tsx as a
 * loader, and pins `--dns-result-order=ipv4first --no-network-family-autoselection`
 * — on WSL2 the dual-stack host's dead IPv6 + Node's Happy Eyeballs stalls every
 * fetch otherwise (the same trap as vault-sync and the dev/build scripts).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { APERTURE_CONTEXT, apertureHistPath } from "../src/lib/aevcontext";
import { normalizeAperture, type ApertureDoc } from "../src/lib/aperture";
import { APERTURE_GLANCE_PATH, APERTURE_PATH } from "../src/lib/aperturestore";
import {
  apertureGlance,
  diffSummary,
  explainApertureRejection,
  sealDay,
} from "../src/lib/aperturesync";
import {
  fromB64url,
  isKeystore,
  open,
  seal,
  unwrapMk,
} from "../src/lib/crypto";
import { deriveKekForKdf } from "../src/lib/kdf";
import { r2Enabled, readKey, writeKey, type StoreWrite } from "../src/lib/r2";

/** The one file this script reads, inside APERTURE_DIR. */
const DOC_FILE = "aperture.json";

// ---------------------------------------------------------------------------
// the local document (read + validated before anything else happens)
// ---------------------------------------------------------------------------

/**
 * Read and validate `aperture.json`. Every failure mode gets its own message
 * naming the file — a missing folder, an unreadable file, JSON that doesn't parse,
 * and a document that parses but doesn't fit the frame are four different mistakes
 * with four different fixes. The last one leans on `explainApertureRejection` to
 * name the field; `normalizeAperture` remains the gate that decided.
 */
async function loadDoc(dir: string): Promise<ApertureDoc> {
  const file = path.join(dir, DOC_FILE);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") throw new Error(`${file} does not exist`);
    throw new Error(
      `${file} could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const doc = normalizeAperture(parsed);
  if (!doc)
    throw new Error(
      `${file} was rejected — ${explainApertureRejection(parsed)}`,
    );
  return doc;
}

// ---------------------------------------------------------------------------
// store helpers (the R2 credentials are read from the env by src/lib/r2)
// ---------------------------------------------------------------------------

/**
 * Unwrap the MK from `meta/keystore`. A malformed/absent keystore aborts with a
 * clear message; a wrong passphrase makes `unwrapMk` throw on the GCM tag, which we
 * translate to "wrong passphrase". Verbatim vault-sync, including its refusal to
 * read a transport failure as an absent keystore — a flake must never print the
 * "set up the key first" message.
 */
async function unwrapMasterKey(passphrase: string): Promise<CryptoKey> {
  const read = await readKey("meta/keystore");
  if (read.state === "error")
    throw new Error(
      "reading meta/keystore failed — check the R2_* env vars / network",
    );
  if (read.state === "absent")
    throw new Error(
      "meta/keystore not found — set up the encryption key in the files inbox first",
    );

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(read.value));
  } catch {
    throw new Error("meta/keystore is not valid JSON");
  }
  if (!isKeystore(json))
    throw new Error("meta/keystore is not a valid keystore");

  // The dispatcher derives with whatever the keystore says — pbkdf2 or
  // argon2id (hash-wasm runs the same WASM under Node).
  const kek = await deriveKekForKdf(json.kdf, passphrase);
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
 * The document this run is replacing, for the dated archive and the diff summary.
 * Absent, a flaky read, an envelope sealed under a different key, and a stale shape
 * all collapse to null — with a warning where the store had something it couldn't
 * hand back, since a null here now costs an ARCHIVE as well as a summary line: the
 * overwrite in main() will destroy whatever this couldn't open. Still not fatal —
 * the new seal doesn't depend on the old one — but worth a louder line.
 */
async function loadPriorDoc(mk: CryptoKey): Promise<ApertureDoc | null> {
  const read = await readKey(APERTURE_PATH);
  if (read.state === "absent") return null;
  if (read.state === "error") {
    console.error(
      "⚠ the prior envelope could not be read — it will NOT be archived, and the summary will read as a first seal",
    );
    return null;
  }
  try {
    const { bytes } = await open(mk, read.value, APERTURE_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const doc = normalizeAperture(parsed);
    if (!doc) throw new Error("bad shape");
    return doc;
  } catch {
    console.error(
      "⚠ the prior envelope exists but cannot be opened — it will NOT be archived, and the summary will read as a first seal",
    );
    return null;
  }
}

/**
 * Seal `doc` a second time at its dated history key and write it, returning the
 * key and the write's verdict for the call site to judge (the two sites abort
 * differently — before the main overwrite nothing has changed yet; after it, a
 * rerun converges). AAD is the dated key ITSELF, not APERTURE_CONTEXT: each
 * archived seal binds its own address, so two weeks can never be swapped.
 *
 * Plain overwrite, like every write this script owns. That is also the same-day
 * rule: syncing twice on one Sydney day leaves the day's LAST document at the
 * dated key, which is exactly what "the seal as of that date" should mean.
 */
async function archiveSeal(
  mk: CryptoKey,
  doc: ApertureDoc,
): Promise<{ path: string; wrote: StoreWrite }> {
  const day = sealDay(doc.sealedAt);
  const path = apertureHistPath(day);
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const envelope = await seal(
    mk,
    { n: `aperture-${day}.json`, t: "application/json", s: bytes.length },
    bytes,
    path,
  );
  const wrote = await writeKey(path, envelope, {
    overwrite: true,
    contentType: "application/octet-stream",
  });
  return { path, wrote };
}

// ---------------------------------------------------------------------------
// hidden passphrase prompt
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
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!r2Enabled())
    throw new Error(
      "R2 store is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
        "R2_SECRET_ACCESS_KEY, and R2_BUCKET (loaded from .env.local via --env-file)",
    );
  const apertureDir = process.env.APERTURE_DIR ?? process.argv[2];
  if (!apertureDir)
    throw new Error("APERTURE_DIR is required (env var or first argument)");
  const dir = path.resolve(apertureDir);

  // 1. validate FIRST — a bad document must cost nothing but an error message
  const doc = await loadDoc(dir);
  console.error(`· ${path.join(dir, DOC_FILE)} validated`);

  // 2. unwrap the master key (wrong passphrase throws here)
  const passphrase = await readPassphrase();
  const mk = await unwrapMasterKey(passphrase);
  console.error("· unlocked the vault key");

  // 3. the prior document, for the archive and the summary
  const prior = await loadPriorDoc(mk);

  // 4. archive the prior at its dated key BEFORE the overwrite in step 5 destroys
  // the only other copy of it. Failing here aborts with the store untouched —
  // better no sync than a sync that ate a week of the record.
  if (prior !== null) {
    const arch = await archiveSeal(mk, prior);
    if (arch.wrote !== "ok")
      throw new Error(
        `archiving the prior seal to ${arch.path} failed (${arch.wrote}) — nothing changed`,
      );
    console.error(`· archived the prior seal → ${arch.path}`);
  }

  // 5. seal the whole document — the plaintext the browser parses and re-validates
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const envelope = await seal(
    mk,
    { n: "aperture.json", t: "application/json", s: bytes.length },
    bytes,
    APERTURE_CONTEXT,
  );
  console.error(`· writing the envelope (${envelope.length} bytes)…`);
  const sealed = await writeKey(APERTURE_PATH, envelope, {
    overwrite: true,
    contentType: "application/octet-stream",
  });
  if (sealed !== "ok")
    throw new Error(
      `writing ${APERTURE_PATH} failed (${sealed}) — nothing changed`,
    );

  // 6. then the glance. Envelope first, so a run that dies between the two leaves
  // the band a rank OLDER than the sealed document rather than one the document
  // can't back up — and says so, because the two must converge on a rerun.
  const glanceBody = JSON.stringify(apertureGlance(doc));
  console.error("· writing the glance…");
  const glanced = await writeKey(APERTURE_GLANCE_PATH, glanceBody, {
    overwrite: true,
    contentType: "application/json",
  });
  if (glanced !== "ok")
    throw new Error(
      `envelope sealed, glance write FAILED (${glanced}) — rerun to converge`,
    );

  // 7. this seal's own dated copy, LAST — the two live objects the band reads are
  // already converged, and a death here costs nothing durable: the next run
  // archives this same document as the prior in step 4.
  const arch = await archiveSeal(mk, doc);
  if (arch.wrote !== "ok")
    throw new Error(
      `synced, but archiving this seal to ${arch.path} failed (${arch.wrote}) — ` +
        "rerun to archive it now, or the next sync archives it as the prior",
    );
  console.error(`· archived this seal → ${arch.path}`);

  console.log(diffSummary(prior, doc));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
