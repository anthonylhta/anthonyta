import { parseShareSegment, SHARE_PREFIX } from "./files";
import { r2Delete, r2Enabled, r2Get, r2List } from "./r2";

/**
 * shares — the guarded R2 I/O layer for fragment-key share links (ADR 0058,
 * storage on R2 since ADR 0060).
 *
 * A share re-encrypts one inbox file under a FRESH one-time key (never the master
 * key) and stores the ciphertext at `share/<expiry>-e-<id>.bin`; the key rides the
 * URL `#fragment`, so the server holds a blob it can never open. The expiry is
 * encoded in the NAME — the cron sweeps stale shares by key without decrypting, and
 * a tampered expiry in a link resolves to a different key → a 404, not a longer life.
 *
 * Like every connector (ADR 0003) this degrades rather than throws: no `R2_*` env
 * (local dev, CI) → the store is off, a read returns `null`, and the sweep no-ops
 * to `0`.
 */

export const SHARE_TTL_DAYS = 7;

/**
 * Stream a share's ciphertext by URL segment, or `null` when the segment is malformed,
 * EXPIRED, absent, or the store is off. The expiry is read straight from the segment
 * and checked BEFORE any read — cheap, and tamper-safe, since a forged expiry lands
 * on a key that was never written.
 */
export async function readShareStream(
  seg: string,
  nowEpochSec: number,
): Promise<ReadableStream | null> {
  const parsed = parseShareSegment(seg);
  if (!parsed || parsed.expiry <= nowEpochSec) return null;
  if (!r2Enabled()) return null;
  try {
    const res = await r2Get(`${SHARE_PREFIX}${seg}.bin`);
    if (!res.ok || !res.body) return null;
    return res.body;
  } catch (err) {
    console.error("[shares] read failed:", seg, err);
    return null;
  }
}

/**
 * Delete every share whose encoded expiry is at or before `nowEpochSec`, returning the
 * count deleted (`0` when the store is off). Lists the whole `share/` prefix
 * (paginating on the continuation token, like `finstore.readSnapshots`), reads each
 * expiry from the leaf name without decrypting, and deletes the stale ones. Never
 * throws: a failed list or delete is logged and the count so far is returned.
 */
export async function sweepExpiredShares(nowEpochSec: number): Promise<number> {
  if (!r2Enabled()) return 0;
  let count = 0;
  try {
    let token: string | undefined;
    do {
      const page = await r2List(SHARE_PREFIX, token);
      for (const o of page.objects) {
        const leaf = o.key.slice(SHARE_PREFIX.length).replace(/\.bin$/, "");
        const parsed = parseShareSegment(leaf);
        if (parsed && parsed.expiry <= nowEpochSec) {
          await r2Delete(o.key);
          count++;
        }
      }
      token = page.next;
    } while (token);
  } catch (err) {
    console.error("[shares] sweep failed:", err);
  }
  return count;
}
