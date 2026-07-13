import { r2Enabled, readKey, writeKey } from "./r2";
import type { StoreRead } from "./r2";
import { isCspDay, type CspDay } from "./cspreport";

/**
 * cspstore — the guarded R2 I/O for first-party CSP violation reports (roadmap 37e).
 * Sibling to anastore/finstore: it owns the `meta/csp/*` keys and speaks only to the
 * public /api/csp-report recorder and the owner's command-center panel.
 *
 * Guarded like every store (finstore): no `R2_*` env (local dev, CI) → the store is
 * off, reads report empty/error and writes no-op, so recording quietly does nothing
 * and the panel shows its "0 violations" zero state.
 *
 * The three-state read is load-bearing exactly as it is on anastore's day records:
 * the recorder read-modify-writes today's fold record, so an "error" misread as
 * "absent" would rebuild the day from empty and lose its counts. "error" therefore
 * never writes; "absent" is only ever a genuine first-report-of-the-day empty.
 */

const CSP_PREFIX = "meta/csp/";

function dayPath(date: string): string {
  return `${CSP_PREFIX}${date}.json`;
}

/** Add `delta` calendar days to a `YYYY-MM-DD` via UTC-midnight math (DST-safe — only
 *  ever touches the calendar). Local to the store, as in anastore. */
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * One day's fold record, three-state. "absent" is a genuine empty day (no report
 * written yet); a corrupt-but-readable record collapses to "error" so the recorder's
 * read-modify-write refuses to overwrite it rather than rebuilding from empty.
 */
export async function readDay(date: string): Promise<StoreRead<CspDay>> {
  const read = await readKey(dayPath(date));
  if (read.state !== "ok") return read;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
    if (isCspDay(parsed)) return { state: "ok", value: parsed };
  } catch {
    // fall through
  }
  return { state: "error" };
}

/**
 * Overwrite today's fold record. The recorder is the single conceptual writer, so no
 * conflict handling is needed; two reports racing the same record may drop a count —
 * the accepted tradeoff at this volume, mirroring anastore's approximate aggregates.
 * `true` on a successful write, `false` when the store is off or the write fails.
 */
export async function writeDay(day: CspDay): Promise<boolean> {
  const wrote = await writeKey(dayPath(day.date), JSON.stringify(day), {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}

/**
 * The last `n` day records ending at `today` (missing/errored days simply drop out),
 * oldest first. Empty when the store is off. For the owner panel's read-only view.
 */
export async function readCspDays(today: string, n: number): Promise<CspDay[]> {
  if (!r2Enabled()) return [];
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) dates.push(addDays(today, -i));
  const reads = await Promise.all(dates.map(readDay));
  return reads.flatMap((r) => (r.state === "ok" ? [r.value] : []));
}
