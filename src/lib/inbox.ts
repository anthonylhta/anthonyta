import { del, issueSignedToken, list, presignUrl } from "@vercel/blob";
import {
  INBOX_PREFIX,
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
export const LINK_TTL_SECONDS = 3600; // shareable copy-link

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
    return { files: sortInbox(blobs.map(toInboxFile)), offline: false };
  } catch (err) {
    console.error("[inbox] list failed:", err);
    return { files: [], offline: true };
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

/**
 * Mint a short-lived signed GET URL for a private blob, good for `ttlSeconds`. `null` when
 * the store is off, the pathname is malformed, or either signing step throws. Callers pass
 * `DL_TTL_SECONDS` for an immediate 302 or `LINK_TTL_SECONDS` for a copyable share link.
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
