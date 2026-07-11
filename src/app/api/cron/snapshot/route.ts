import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { authorizeCron } from "@/lib/cron-auth";
import {
  isSnapIndex,
  sydneyToday,
  upsertIndexDay,
  type SnapIndex,
} from "@/lib/fin";
import { getSnapIndex, putSnapIndex } from "@/lib/finstore";
import { sweepExpiredShares } from "@/lib/shares";

export const dynamic = "force-dynamic";

/**
 * Nightly cron. Two jobs since ADR 0061 (the sealed-box net-worth snapshot is
 * retired — history now reconstructs client-side from the fin envelope's step
 * functions, so the server no longer touches an invested figure, even transiently):
 *
 * - `index` — the plaintext reading-day count (no secret, so it rides unsealed as
 *             the week-over-week baseline; the deliberate E2EE boundary, ADR 0054).
 *             A read-modify-write over ~400 days of history, so a flaky read is
 *             `failed`, NEVER mistaken for absent — overwriting the index off a
 *             transient error would erase the record (the keystore lesson).
 * - `swept` — the count of expired fragment-key share envelopes reaped (ADR 0058).
 *             It piggybacks on this already-authorized nightly run;
 *             `sweepExpiredShares` never throws, but a defensive `catch → -1`
 *             keeps a sweep hiccup from sinking the snapshot.
 *
 * Runs late each Sydney evening via Vercel Cron (vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; required, fail-closed in production
 * (lib/cron-auth). The finstore is guarded, so a store that's off no-ops cleanly.
 */

type Outcome = "written" | "skipped" | "failed";

/** Merge today's reading count into the plaintext index (read-modify-write). */
async function writeIndex(
  reading: Awaited<ReturnType<typeof getCurrentlyReading>>,
  snapIndex: Awaited<ReturnType<typeof getSnapIndex>>,
  date: string,
): Promise<Outcome> {
  // Guarded connector fallback (`[]`) — a forced 0 would poison the weekly delta.
  if (reading.length === 0) return "skipped";
  const readingChapters = reading.reduce((sum, r) => sum + r.chapter, 0);

  // A flaky read must NEVER read as absent: this rewrites the whole history, so an
  // error-as-empty would clobber ~400 days of days with a single fresh entry.
  if (snapIndex.state === "error") return "failed";

  let index: SnapIndex;
  if (snapIndex.state === "absent") {
    index = { v: 1, days: [] };
  } else {
    try {
      const parsed: unknown = JSON.parse(snapIndex.value);
      if (!isSnapIndex(parsed)) throw new Error("index: unrecognized shape");
      index = parsed;
    } catch (err) {
      // Don't overwrite something we can't recognize.
      console.error("[cron:snapshot] index parse failed:", err);
      return "failed";
    }
  }

  const next = upsertIndexDay(index, { date, readingChapters });
  return (await putSnapIndex(JSON.stringify(next))) ? "written" : "failed";
}

export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const date = sydneyToday();
  const [reading, snapIndex] = await Promise.all([
    getCurrentlyReading(),
    getSnapIndex(),
  ]);

  const [index, swept] = await Promise.all([
    writeIndex(reading, snapIndex, date),
    // A sweep failure must never fail the snapshot (the sweep never throws anyway).
    sweepExpiredShares(Math.floor(Date.now() / 1000)).catch(() => -1),
  ]);

  return Response.json({
    date,
    index,
    swept,
    at: new Date().toISOString(),
  });
}
