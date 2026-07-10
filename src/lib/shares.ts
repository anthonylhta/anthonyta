import { del, get, list } from "@vercel/blob";
import { blobEnabled } from "./finstore";
import { parseShareSegment, SHARE_PREFIX } from "./files";

/**
 * shares — the guarded Vercel Blob I/O layer for fragment-key share links.
 *
 * A share re-encrypts one inbox file under a FRESH one-time key (never the master key)
 * and stores the ciphertext at `share/<expiry>-e-<id>.bin`; the key rides the URL
 * `#fragment`, so the server holds a blob it can never open. The expiry is encoded in
 * the NAME — the cron sweeps stale shares by pathname without decrypting, and a
 * tampered expiry in a link resolves to a different pathname → a 404, not a longer life.
 *
 * Like every connector (ADR 0003) this degrades rather than throws: no
 * `BLOB_READ_WRITE_TOKEN` (local dev, CI) → the store is off, a read returns `null`,
 * and the sweep no-ops to `0`. Reuses `finstore.blobEnabled()` — the SDK reads the
 * token straight off `process.env`, so presence is all we check.
 */

export const SHARE_TTL_DAYS = 7;

/**
 * Stream a share's ciphertext by URL segment, or `null` when the segment is malformed,
 * EXPIRED, absent, or the store is off. The expiry is read straight from the segment
 * and checked BEFORE any blob read — cheap, and tamper-safe, since a forged expiry
 * lands on a pathname that was never written. The `get` result carries content as a
 * stream (mirrors `inbox.readFileStream`).
 */
export async function readShareStream(
  seg: string,
  nowEpochSec: number,
): Promise<ReadableStream | null> {
  const parsed = parseShareSegment(seg);
  if (!parsed || parsed.expiry <= nowEpochSec) return null;
  if (!blobEnabled()) return null;
  try {
    const res = await get(`${SHARE_PREFIX}${seg}.bin`, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    return res.stream;
  } catch (err) {
    console.error("[shares] read failed:", seg, err);
    return null;
  }
}

/**
 * Delete every share whose encoded expiry is at or before `nowEpochSec`, returning the
 * count deleted (`0` when the store is off). Lists the whole `share/` prefix
 * (paginating on the cursor, like `finstore.readSnapshots`), reads each expiry from the
 * leaf name without decrypting, and `del`s the stale ones. Never throws: a failed list
 * or delete is logged and the count so far is returned.
 */
export async function sweepExpiredShares(nowEpochSec: number): Promise<number> {
  if (!blobEnabled()) return 0;
  let count = 0;
  try {
    let cursor: string | undefined;
    do {
      const res = await list({ prefix: SHARE_PREFIX, cursor });
      for (const b of res.blobs) {
        const leaf = b.pathname
          .slice(SHARE_PREFIX.length)
          .replace(/\.bin$/, "");
        const parsed = parseShareSegment(leaf);
        if (parsed && parsed.expiry <= nowEpochSec) {
          await del(b.pathname);
          count++;
        }
      }
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error("[shares] sweep failed:", err);
  }
  return count;
}
