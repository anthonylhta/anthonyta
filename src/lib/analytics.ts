/**
 * Privacy-preserving analytics — count what recruiters actually look at, without
 * tracking anyone. No cookies, no stored IP, no cross-day identity. A visitor's
 * signal (IP + user-agent) is hashed ONCE against a random salt that rotates every
 * day and is then discarded, so after midnight the day's hashes can't be linked to a
 * person or to the next day's — they collapse into pure aggregates. Uniqueness is
 * counted with a HyperLogLog sketch, so even the daily hashes are never stored: the
 * sketch holds an estimate, not a set of identities (the Plausible/Fathom approach,
 * taken a step further).
 *
 * Pure and dependency-free — the recording route derives the salt, hashes the signal,
 * folds it into the sketch, and read-modify-writes a small daily record; all the
 * primitives here are unit-testable on their own.
 */

// --- daily salt + visitor hash ------------------------------------------------

/** A fresh 16-byte daily salt. Kept only for its day; rotation discards it, which is
 *  what makes yesterday's visitor hashes unrecoverable. */
export function newDaySalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * A per-day visitor id: SHA-256(salt || ip || "\n" || userAgent). The raw signal is
 * hashed immediately and never stored; the salt rotates daily, so the same person on
 * two days hashes to two unrelated ids. Returns the 32 raw bytes (fed straight into
 * the sketch).
 */
export async function visitorHash(
  salt: Uint8Array,
  ip: string,
  userAgent: string,
): Promise<Uint8Array> {
  const sig = new TextEncoder().encode(`${ip}\n${userAgent}`);
  const buf = new Uint8Array(salt.length + sig.length);
  buf.set(salt, 0);
  buf.set(sig, salt.length);
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", buf as BufferSource),
  );
}

// --- HyperLogLog (unique-visitor cardinality without storing identities) ------
//
// Precision 10 → 1024 registers → ~3% standard error, ~1 KB per counter. Each
// observed hash picks a register by its top 10 bits and records the rank (leading
// zeros + 1) of the rest; the harmonic mean of 2^register across all registers
// estimates the number of distinct inputs. Registers merge by max, so per-path and
// site-wide sketches compose, and two days' sketches could union if ever wanted.

export const HLL_PRECISION = 10;
export const HLL_REGISTERS = 1 << HLL_PRECISION; // 1024

/** A fresh, empty sketch. */
export function newHll(): Uint8Array {
  return new Uint8Array(HLL_REGISTERS);
}

/** Observe one hash into the sketch (mutates in place). Uses the first 4 hash bytes. */
export function hllAdd(reg: Uint8Array, hash: Uint8Array): void {
  const w =
    ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
  const idx = w >>> (32 - HLL_PRECISION); // top PRECISION bits → register
  const rest = (w << HLL_PRECISION) >>> 0; // remaining bits, left-aligned
  // rank = position of the first 1 among the remaining bits (+1); all-zero → the max.
  const rank = rest === 0 ? 32 - HLL_PRECISION + 1 : Math.clz32(rest) + 1;
  if (rank > reg[idx]) reg[idx] = rank;
}

/** Estimated distinct count from a sketch (Flajolet estimator + small-range linear
 *  counting). Rounded to an integer. */
export function hllEstimate(reg: Uint8Array): number {
  const m = reg.length;
  const alpha = 0.7213 / (1 + 1.079 / m); // m ≥ 128
  let sum = 0;
  let zeros = 0;
  for (const r of reg) {
    sum += 2 ** -r;
    if (r === 0) zeros++;
  }
  let est = (alpha * m * m) / sum;
  // Small cardinalities are better estimated by counting empty registers.
  if (est <= 2.5 * m && zeros > 0) est = m * Math.log(m / zeros);
  return Math.round(est);
}

/** Register-wise max of two sketches → the sketch of their union. Never mutates. */
export function hllMerge(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error("hll: register length mismatch");
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.max(a[i], b[i]);
  return out;
}

// --- daily record shape -------------------------------------------------------

/** One path's tally for a day: raw pageviews + a unique-visitor sketch (b64). */
export interface PathStat {
  views: number;
  /** base64 of the HLL registers. */
  hll_b64: string;
}

/** One day of aggregates. `visitors` is the site-wide unique sketch; `paths` is
 *  per-path. Nothing here identifies a person. */
export interface DayStats {
  v: 1;
  date: string;
  visitors_hll_b64: string;
  paths: Record<string, PathStat>;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Strict guard for a stored daily record (the recording route read-modify-writes it). */
export function isDayStats(x: unknown): x is DayStats {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Record<string, unknown>;
  if (d.v !== 1 || typeof d.date !== "string" || !YMD.test(d.date))
    return false;
  if (typeof d.visitors_hll_b64 !== "string") return false;
  if (typeof d.paths !== "object" || d.paths === null) return false;
  for (const stat of Object.values(d.paths as Record<string, unknown>)) {
    if (typeof stat !== "object" || stat === null) return false;
    const s = stat as Record<string, unknown>;
    if (
      !Number.isSafeInteger(s.views) ||
      (s.views as number) < 0 ||
      typeof s.hll_b64 !== "string"
    )
      return false;
  }
  return true;
}

/**
 * The overflow bucket a day's per-path breakdown lumps long-tail/abusive paths
 * into once the cap is reached. Not a valid app path (no leading slash — the
 * recorder's `isAppPath` requires one), so it can never collide with a real
 * pageview's `location.pathname`.
 */
export const OVERFLOW_PATH = "(other)";

/**
 * Cap on distinct per-path buckets in one day's record. The public site has well
 * under this many real routes, so legitimate traffic never reaches it; a flood of
 * junk paths (a scanner hitting `/wp-admin`, `/.env`, … — each a distinct 404 that
 * still fires the beacon) does. Past the cap a new path folds into OVERFLOW_PATH
 * rather than minting a fresh ~1.4 KB sketch, bounding a day record to
 * MAX_TRACKED_PATHS + 1 buckets.
 */
export const MAX_TRACKED_PATHS = 100;

/**
 * The bucket key a hit to `path` should land in, given the paths already tracked
 * today: the path itself if it's already tracked or there's still room under the
 * cap, else the overflow bucket. Pure. Only the per-path breakdown is capped — the
 * site-wide visitor sketch counts every hit regardless of which bucket it lands in.
 */
export function pathBucket(
  paths: Record<string, unknown>,
  path: string,
  cap: number = MAX_TRACKED_PATHS,
): string {
  if (Object.prototype.hasOwnProperty.call(paths, path)) return path;
  if (Object.keys(paths).length >= cap) return OVERFLOW_PATH;
  return path;
}

/** The paths of a day sorted by pageviews, most-visited first — for the dashboard. */
export function topPaths(
  day: DayStats,
): { path: string; views: number; uniques: number }[] {
  return Object.entries(day.paths)
    .map(([path, s]) => ({
      path,
      views: s.views,
      uniques: hllEstimate(b64ToBytes(s.hll_b64)),
    }))
    .sort((a, b) => b.views - a.views);
}

// --- base64 for the packed sketches (Node + browser) --------------------------

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
