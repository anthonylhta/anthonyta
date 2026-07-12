import {
  b64ToBytes,
  bytesToB64,
  hllAdd,
  hllMerge,
  isDayStats,
  newDaySalt,
  newHll,
  visitorHash,
  type DayStats,
} from "./analytics";
import { r2Delete, r2Enabled, r2List, readKey, writeKey } from "./r2";
import type { StoreRead } from "./r2";

/**
 * anastore — the guarded R2 I/O for the privacy-preserving analytics layer. Sibling
 * to finstore: it owns the `meta/analytics/*` keys and speaks only to the /api/hit
 * recorder and the owner's command-center dashboard.
 *
 * Two shapes, one privacy contract (see analytics.ts):
 *   - `meta/analytics/salt` — today's rotating salt, `{ date, salt_b64 }`. The salt
 *     NEVER leaves this module: callers hand us (ip, ua) and get back a hash, so the
 *     raw salt can't be logged or leaked. Rotation (a new day → mint fresh, discard
 *     yesterday's) IS the guarantee that a day's visitor hashes become unlinkable.
 *   - `meta/analytics/day/<YYYY-MM-DD>.json` — one plaintext `DayStats` per day. A
 *     leak reveals only traffic SHAPE (view counts + HLL sketches), never identity.
 *
 * Guarded like every store (finstore): no `R2_*` env → the store is off, reads report
 * empty/error and writes no-op, so recording quietly does nothing and the dashboard
 * shows its empty state. The three-state read/no-clobber write discipline is
 * load-bearing on the day records exactly as it is on finstore's index: the recorder
 * read-modify-writes a day, so an "error" misread as "absent" would clobber the day's
 * accumulated counts. "error" therefore never writes.
 */

const SALT_PATH = "meta/analytics/salt";
const DAY_PREFIX = "meta/analytics/day/";

/** Day records older than this are pruned — the aggregates are the point, not a
 *  years-long archive. */
export const RETENTION_DAYS = 90;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function dayPath(date: string): string {
  return `${DAY_PREFIX}${date}.json`;
}

/** Add `delta` calendar days to a `YYYY-MM-DD` via UTC-midnight math (DST-safe —
 *  only ever touches the calendar). Local to the store; fin.ts keeps its own copy. */
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// --- salt (never exposed) -----------------------------------------------------

interface StoredSalt {
  date: string;
  salt_b64: string;
}

function isStoredSalt(x: unknown): x is StoredSalt {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return typeof s.date === "string" && typeof s.salt_b64 === "string";
}

/**
 * Today's salt bytes, rotating on a date change. `null` when the store is off OR a
 * read errored (a store hiccup skips the hit — never clobber a good salt off a flaky
 * read). "absent", a stale date, or a corrupt record all mint a fresh salt and
 * OVERWRITE, discarding yesterday's — which is what unlinks the two days. Module-
 * private: the salt is never returned across the module boundary.
 */
async function getTodaySalt(today: string): Promise<Uint8Array | null> {
  if (!r2Enabled()) return null;
  const read = await readKey(SALT_PATH);
  if (read.state === "error") return null;
  if (read.state === "ok") {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
      if (isStoredSalt(parsed) && parsed.date === today)
        return b64ToBytes(parsed.salt_b64);
    } catch {
      // corrupt salt record → fall through and rotate
    }
  }
  const salt = newDaySalt();
  const wrote = await writeKey(
    SALT_PATH,
    JSON.stringify({
      date: today,
      salt_b64: bytesToB64(salt),
    } satisfies StoredSalt),
    { overwrite: true, contentType: "application/json" },
  );
  return wrote === "ok" ? salt : null;
}

/**
 * The per-day visitor hash for (ip, ua), derived under today's rotating salt — the
 * ONLY way the recorder touches the salt. `null` when the store is off or a read
 * errored, in which case the caller skips the hit.
 */
export async function todayVisitorHash(
  today: string,
  ip: string,
  userAgent: string,
): Promise<Uint8Array | null> {
  const salt = await getTodaySalt(today);
  if (!salt) return null;
  return visitorHash(salt, ip, userAgent);
}

// --- day records --------------------------------------------------------------

/**
 * One day's aggregates, three-state. "absent" is a genuine empty day (first hit not
 * yet written); a corrupt-but-readable record collapses to "error" so the recorder's
 * read-modify-write refuses to overwrite it. The distinction is load-bearing: an
 * "error" misread as "absent" would rebuild the day from empty and lose its counts.
 */
export async function readDay(date: string): Promise<StoreRead<DayStats>> {
  const read = await readKey(dayPath(date));
  if (read.state !== "ok") return read;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
    if (isDayStats(parsed)) return { state: "ok", value: parsed };
  } catch {
    // fall through
  }
  return { state: "error" };
}

/**
 * The last `n` days of records ending at `today` (missing/errored days simply drop
 * out), oldest first. Empty when the store is off. For the dashboard's read-only view.
 */
export async function readDays(today: string, n: number): Promise<DayStats[]> {
  if (!r2Enabled()) return [];
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) dates.push(addDays(today, -i));
  const reads = await Promise.all(dates.map(readDay));
  return reads.flatMap((r) => (r.state === "ok" ? [r.value] : []));
}

/**
 * Fold one visitor hash into today's record: `views++` for `path` and an `hllAdd`
 * into both that path's sketch and the site-wide sketch, then write. `true` on a
 * successful write. No-ops (returns false) when the store is off or the read errored
 * — an "error" never clobbers the day. Concurrency is last-writer-wins: two hits
 * racing the same second's record may drop one view/one sketch update, the accepted
 * tradeoff at this volume against locking an aggregate that's already approximate.
 */
export async function recordHit(
  today: string,
  path: string,
  hash: Uint8Array,
): Promise<boolean> {
  if (!r2Enabled()) return false;
  const read = await readDay(today);
  if (read.state === "error") return false;
  const firstOfDay = read.state === "absent";
  const day: DayStats =
    read.state === "ok"
      ? read.value
      : { v: 1, date: today, visitors_hll_b64: "", paths: {} };

  const site = day.visitors_hll_b64
    ? b64ToBytes(day.visitors_hll_b64)
    : newHll();
  hllAdd(site, hash);
  day.visitors_hll_b64 = bytesToB64(site);

  const stat = day.paths[path] ?? { views: 0, hll_b64: "" };
  stat.views += 1;
  const preg = stat.hll_b64 ? b64ToBytes(stat.hll_b64) : newHll();
  hllAdd(preg, hash);
  stat.hll_b64 = bytesToB64(preg);
  day.paths[path] = stat;

  const wrote = await writeKey(dayPath(today), JSON.stringify(day), {
    overwrite: true,
    contentType: "application/json",
  });

  // Retention rides the first hit of each new day (once/day, cheap) rather than a
  // dedicated cron — fire-and-forget so it never delays the recorder's 204.
  if (firstOfDay && wrote === "ok") void pruneOldDays(today).catch(() => {});

  return wrote === "ok";
}

// --- dashboard aggregation ----------------------------------------------------

/**
 * Merge day records into one combined `DayStats` — summed views, register-max HLLs —
 * so the dashboard can total a week's uniques and paths without the server ever
 * reconstructing an identity. Pure. `date` is the latest in the set ("" if empty).
 */
export function mergeDays(days: DayStats[]): DayStats {
  let visitors = newHll();
  const paths: Record<string, { views: number; reg: Uint8Array }> = {};
  let date = "";
  for (const d of days) {
    if (d.date > date) date = d.date;
    if (d.visitors_hll_b64)
      visitors = hllMerge(visitors, b64ToBytes(d.visitors_hll_b64));
    for (const [p, s] of Object.entries(d.paths)) {
      const cur = paths[p] ?? { views: 0, reg: newHll() };
      cur.views += s.views;
      if (s.hll_b64) cur.reg = hllMerge(cur.reg, b64ToBytes(s.hll_b64));
      paths[p] = cur;
    }
  }
  return {
    v: 1,
    date,
    visitors_hll_b64: bytesToB64(visitors),
    paths: Object.fromEntries(
      Object.entries(paths).map(([p, s]) => [
        p,
        { views: s.views, hll_b64: bytesToB64(s.reg) },
      ]),
    ),
  };
}

// --- retention ----------------------------------------------------------------

/**
 * Pure: which listed day-record keys fall outside the `windowDays`-day window ending
 * at `today`. A key is expired when its `YYYY-MM-DD` leaf sorts before the cutoff;
 * anything that doesn't parse is left alone (never delete what we can't date).
 */
export function expiredDayKeys(
  keys: string[],
  today: string,
  windowDays: number,
): string[] {
  const cutoff = addDays(today, -windowDays);
  return keys.filter((k) => {
    if (!k.startsWith(DAY_PREFIX)) return false;
    const leaf = k.slice(DAY_PREFIX.length).replace(/\.json$/, "");
    return YMD.test(leaf) && leaf < cutoff;
  });
}

/**
 * Delete day records older than the retention window, returning the count removed
 * (`0` when the store is off). Never throws — a failed list or delete is logged and
 * the count so far returned. Wired opportunistically from `recordHit`'s first write
 * of each day; also safe to call from a maintenance/cron pass.
 */
export async function pruneOldDays(
  today: string,
  windowDays = RETENTION_DAYS,
): Promise<number> {
  if (!r2Enabled()) return 0;
  let count = 0;
  try {
    let token: string | undefined;
    do {
      const page = await r2List(DAY_PREFIX, token);
      const expired = expiredDayKeys(
        page.objects.map((o) => o.key),
        today,
        windowDays,
      );
      for (const key of expired) {
        await r2Delete(key);
        count++;
      }
      token = page.next;
    } while (token);
  } catch (err) {
    console.error("[anastore] prune failed:", err);
  }
  return count;
}
