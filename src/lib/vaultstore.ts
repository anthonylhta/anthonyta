import { get } from "@vercel/blob";
import { isValidVaultPath } from "./vaultblob";

/**
 * vaultstore — the guarded Vercel Blob I/O layer for the E2EE vault ciphertext store
 * (ADR: E2EE vault). Kept apart from `inbox.ts` (the `inbox/` files store) and
 * `finstore.ts` (the `meta/fin*` financial paths); this module owns only the `vault/*`
 * ciphertext blobs the browser decrypts in place, and it never parses their bytes.
 *
 * Like every connector (ADR 0003) it degrades rather than throws: no
 * `BLOB_READ_WRITE_TOKEN` (local dev, CI) → the store is off and reads return null. The
 * SDK reads the token straight off `process.env`, so `blobEnabled()` only confirms it's
 * present. `isValidVaultPath`'s `vault/` prefix requirement structurally excludes
 * `meta/keystore`, the inbox, and traversal probes — the raw route can never exfiltrate
 * key material.
 */

/** The Blob store is only reachable when a read-write token is configured; the SDK
 *  reads the token itself, so presence is all we check. */
export function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Stream one vault blob's raw ciphertext bytes without buffering. `null` when the store
 * is off, the pathname is malformed (which structurally excludes `meta/*` and the inbox),
 * the blob is missing, or the read throws. The `get()` result carries content as a
 * stream, passed straight through.
 */
export async function readVaultStream(
  p: string,
): Promise<ReadableStream | null> {
  if (!blobEnabled() || !isValidVaultPath(p)) return null;
  try {
    const res = await get(p, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    return res.stream;
  } catch (err) {
    console.error("[vault] read failed:", p, err);
    return null;
  }
}
