import {
  INBOX_PREFIX,
  isTextNote,
  isValidPathname,
  sortInbox,
  toInboxFile,
  type InboxFile,
} from "./files";
import {
  r2Delete,
  r2Enabled,
  r2Get,
  r2List,
  r2PresignGet,
  readKey,
  writeKey,
  type StoreRead,
  type StoreWrite,
} from "./r2";

/**
 * inbox — the guarded R2 I/O layer for the private files inbox (ADR 0051,
 * storage on R2 since ADR 0060).
 *
 * The inbox lives in a *private* bucket, so like every connector (ADR 0003) this
 * degrades rather than throws: no `R2_*` env (local dev, CI) → the store is
 * "offline", listings come back empty, and mutating calls no-op.
 *
 * Objects have no public URL; a download is a presigned GET minted per request
 * (`presignDownload`), and the E2EE rows stream through the same-origin raw route
 * instead (ADR 0053).
 */

export const DL_TTL_SECONDS = 300; // immediate 302 download window

/**
 * The E2EE keystore (ADR 0053) — one small JSON blob holding the passphrase-wrapped
 * master key. It lives OUTSIDE `inbox/` on purpose: `isValidPathname` requires the
 * `inbox/` prefix, so no file route can ever be coaxed into serving or deleting it,
 * and a list under `inbox/` never surfaces it.
 */
export const KEYSTORE_PATH = "meta/keystore";
export const KEYSTORE_MAX_BYTES = 2048;

export interface Inbox {
  files: InboxFile[];
  offline: boolean;
}

/**
 * Everything currently under the `inbox/` prefix, normalized and sorted. When the
 * store is off (`offline: true`) or a list throws, degrade to an empty inbox so a
 * page can still render a placeholder instead of crashing.
 */
export async function listInbox(): Promise<Inbox> {
  if (!r2Enabled()) return { files: [], offline: true };
  try {
    const objects = [];
    let token: string | undefined;
    do {
      const page = await r2List(INBOX_PREFIX, token);
      objects.push(...page.objects);
      token = page.next;
    } while (token);
    const files = sortInbox(
      objects.map((o) =>
        toInboxFile({
          pathname: o.key,
          size: o.size,
          uploadedAt: o.lastModified,
        }),
      ),
    );
    await hydrateTextNotes(files);
    return { files, offline: false };
  } catch (err) {
    console.error("[inbox] list failed:", err);
    return { files: [], offline: true };
  }
}

/**
 * Fill in `text` for the small text notes so the list can inline them, mutating in
 * place. Every read is isolated — a failed fetch just leaves that row as a plain
 * file rather than sinking the whole listing — and the pass is skipped entirely
 * when there are no notes. (Legacy plaintext rows only; new notes are E2EE.)
 */
async function hydrateTextNotes(files: InboxFile[]): Promise<void> {
  const notes = files.filter(isTextNote);
  if (notes.length === 0) return;
  await Promise.all(
    notes.map(async (f) => {
      try {
        const res = await r2Get(f.pathname);
        if (res.ok) f.text = await res.text();
      } catch (err) {
        console.error("[inbox] note read failed:", f.pathname, err);
      }
    }),
  );
}

/**
 * Stream one inbox blob's raw bytes (the ciphertext envelope) without buffering.
 * `null` when the store is off, the pathname is malformed (which structurally
 * excludes `meta/*`), the blob is missing, or the read throws.
 */
export async function readFileStream(
  pathname: string,
): Promise<ReadableStream | null> {
  if (!r2Enabled() || !isValidPathname(pathname)) return null;
  try {
    const res = await r2Get(pathname);
    if (!res.ok || !res.body) return null;
    return res.body;
  } catch (err) {
    console.error("[inbox] read failed:", pathname, err);
    return null;
  }
}

/**
 * Delete one blob by pathname. `false` when the store is off, the pathname is
 * malformed, or the delete fails — never surfaces the error to the caller.
 */
export async function deleteFile(pathname: string): Promise<boolean> {
  if (!r2Enabled() || !isValidPathname(pathname)) return false;
  try {
    const res = await r2Delete(pathname);
    return res.ok;
  } catch (err) {
    console.error("[inbox] delete failed:", err);
    return false;
  }
}

export type KeystoreRead =
  | { state: "ok"; json: string }
  | { state: "absent" }
  | { state: "error" };

/**
 * Read the raw keystore JSON. "absent" (a healthy read found none — first run) is
 * kept strictly apart from "error" (store off / read failed): the client treats
 * absent as "run setup", and setup writes a FRESH master key — so mistaking a
 * transient failure for absence would let a routine retry orphan every encrypted
 * item. The route maps absent→404 and error→503 (owner-only; guests never get
 * past the auth gate). The mapping itself lives in `r2.readKey`.
 */
export async function getKeystore(): Promise<KeystoreRead> {
  const read: StoreRead<Uint8Array> = await readKey(KEYSTORE_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", json: new TextDecoder().decode(read.value) };
}

export type KeystoreWrite = StoreWrite;

/**
 * Write the keystore JSON at its fixed path (there is exactly one). `overwrite` is
 * only ever true for a passphrase change; first-run setup writes with it false, so
 * a client that misread a flaky fetch as "no vault yet" physically cannot clobber
 * an existing keystore — the conditional put refuses and reports "conflict". The
 * caller validates the shape; this only moves bytes.
 */
export function putKeystore(
  json: string,
  overwrite: boolean,
): Promise<KeystoreWrite> {
  return writeKey(KEYSTORE_PATH, json, {
    overwrite,
    contentType: "application/json",
  });
}

/**
 * Mint a short-lived presigned GET URL for a private blob, good for `ttlSeconds`.
 * `null` when the store is off, the pathname is malformed, or signing throws. Used
 * by the legacy plaintext download route at `DL_TTL_SECONDS`.
 */
export async function presignDownload(
  pathname: string,
  ttlSeconds: number,
): Promise<string | null> {
  if (!r2Enabled() || !isValidPathname(pathname)) return null;
  try {
    return await r2PresignGet(pathname, ttlSeconds);
  } catch (err) {
    console.error("[inbox] presign failed:", err);
    return null;
  }
}
