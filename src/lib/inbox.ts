import {
  del,
  get,
  issueSignedToken,
  list,
  presignUrl,
  put,
} from "@vercel/blob";
import {
  INBOX_PREFIX,
  isTextNote,
  isValidPathname,
  sortInbox,
  toInboxFile,
  type InboxFile,
} from "./files";

/**
 * inbox — the guarded Vercel Blob I/O layer for the private files inbox.
 *
 * The inbox lives in a *private* Blob store, so like every connector (ADR 0003) this
 * degrades rather than throws: no `BLOB_READ_WRITE_TOKEN` (local dev, CI) → the store is
 * "offline", listings come back empty, and mutating calls no-op. The SDK reads the token
 * straight off `process.env`, so `enabled()` only has to confirm it's present — the
 * store-id / OIDC path the SDK also supports isn't used here.
 *
 * Private blobs have no public URL, so a download is a two-step signed-URL mint:
 * `issueSignedToken` (a delegation scoped to the pathname + the `get` op, expiring at
 * `validUntil`) then `presignUrl` (the concrete `access: "private"` GET URL). Both take a
 * pathname, so no `head()` round-trip to resolve a full URL is needed. The SDK expresses
 * the TTL as an absolute ms-since-epoch `validUntil`, not a duration, hence
 * `Date.now() + ttl * 1000`.
 */

export const DL_TTL_SECONDS = 300; // immediate 302 download window

/**
 * The E2EE keystore (ADR 0053) — one small JSON blob holding the passphrase-wrapped
 * master key. It lives OUTSIDE `inbox/` on purpose: `isValidPathname` requires the
 * `inbox/` prefix, so no file route can ever be coaxed into serving or deleting it,
 * and `list({prefix: "inbox/"})` never surfaces it.
 */
export const KEYSTORE_PATH = "meta/keystore";
export const KEYSTORE_MAX_BYTES = 2048;

export interface Inbox {
  files: InboxFile[];
  offline: boolean;
}

/** The Blob store is only reachable when a read-write token is configured; the SDK
 *  reads the token itself, so presence is all we check. */
function enabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Everything currently under the `inbox/` prefix, normalized and sorted. When the store
 * is off (`offline: true`) or a list throws, degrade to an empty inbox so a page can still
 * render a placeholder instead of crashing.
 */
export async function listInbox(): Promise<Inbox> {
  if (!enabled()) return { files: [], offline: true };
  try {
    const { blobs } = await list({ prefix: INBOX_PREFIX });
    const files = sortInbox(blobs.map(toInboxFile));
    await hydrateTextNotes(files);
    return { files, offline: false };
  } catch (err) {
    console.error("[inbox] list failed:", err);
    return { files: [], offline: true };
  }
}

/**
 * Fill in `text` for the small text notes so the list can inline them, mutating in place.
 * Every read is isolated — a failed fetch just leaves that row as a plain file rather than
 * sinking the whole listing — and the pass is skipped entirely when there are no notes.
 * The `get()` result carries content as a stream (its `blob` field is metadata, not a
 * Blob), so we drain `stream` through a `Response` to a string.
 */
async function hydrateTextNotes(files: InboxFile[]): Promise<void> {
  const notes = files.filter(isTextNote);
  if (notes.length === 0) return;
  await Promise.all(
    notes.map(async (f) => {
      try {
        const res = await get(f.pathname, { access: "private" });
        if (res && res.statusCode === 200) {
          f.text = await new Response(res.stream).text();
        }
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
  if (!enabled() || !isValidPathname(pathname)) return null;
  try {
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    return res.stream;
  } catch (err) {
    console.error("[inbox] read failed:", pathname, err);
    return null;
  }
}

/**
 * Delete one blob by pathname (`del` accepts a pathname directly, no URL lookup). `false`
 * when the store is off, the pathname is malformed, or the delete throws — never surfaces
 * the error to the caller.
 */
export async function deleteFile(pathname: string): Promise<boolean> {
  if (!enabled() || !isValidPathname(pathname)) return false;
  try {
    await del(pathname);
    return true;
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
 * kept strictly apart from "error" (store off / read threw): the client treats
 * absent as "run setup", and setup writes a FRESH master key — so mistaking a
 * transient failure for absence would let a routine retry orphan every encrypted
 * item. The route maps absent→404 and error→503 (owner-only; guests never get
 * past the auth gate).
 */
export async function getKeystore(): Promise<KeystoreRead> {
  if (!enabled()) return { state: "error" };
  try {
    const res = await get(KEYSTORE_PATH, { access: "private" });
    if (!res) return { state: "absent" };
    if (res.statusCode !== 200) return { state: "error" };
    return { state: "ok", json: await new Response(res.stream).text() };
  } catch (err) {
    console.error("[inbox] keystore read failed:", err);
    return { state: "error" };
  }
}

export type KeystoreWrite = "ok" | "conflict" | "failed";

/**
 * Write the keystore JSON at its fixed path (no random suffix — there is exactly
 * one). `overwrite` is only ever true for a passphrase change; first-run setup
 * writes with it false, so a client that misread a flaky fetch as "no vault yet"
 * physically cannot clobber an existing keystore — the put refuses, and the
 * existence re-check reports "conflict". The caller validates the shape; this
 * only moves bytes.
 */
export async function putKeystore(
  json: string,
  overwrite: boolean,
): Promise<KeystoreWrite> {
  if (!enabled()) return "failed";
  try {
    await put(KEYSTORE_PATH, json, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: overwrite,
      contentType: "application/json",
    });
    return "ok";
  } catch (err) {
    if (!overwrite && (await getKeystore()).state === "ok") return "conflict";
    console.error("[inbox] keystore write failed:", err);
    return "failed";
  }
}

/**
 * Mint a short-lived signed GET URL for a private blob, good for `ttlSeconds`. `null` when
 * the store is off, the pathname is malformed, or either signing step throws. Used by the
 * legacy plaintext download route at `DL_TTL_SECONDS`.
 */
export async function presignDownload(
  pathname: string,
  ttlSeconds: number,
): Promise<string | null> {
  if (!enabled() || !isValidPathname(pathname)) return null;
  try {
    const validUntil = Date.now() + ttlSeconds * 1000;
    const token = await issueSignedToken({
      pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(token, {
      access: "private",
      operation: "get",
      pathname,
      validUntil,
    });
    return presignedUrl;
  } catch (err) {
    console.error("[inbox] presign failed:", err);
    return null;
  }
}
