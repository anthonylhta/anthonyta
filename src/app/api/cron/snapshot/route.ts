import { getTft } from "@/lib/connectors/tft";
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
import { isTftHistory, upsertHistoryDay, type TftHistory } from "@/lib/tft";
import { getTftHistoryRaw, putTftHistory } from "@/lib/tftstore";

export const dynamic = "force-dynamic";

/**
 * Nightly cron. Three jobs (the sealed-box net-worth snapshot retired with ADR 0061
 * — history now reconstructs client-side from the fin envelope's step functions, so
 * the server no longer touches an invested figure, even transiently):
 *
 * - `index` — the plaintext reading-day count (no secret, so it rides unsealed as
 *             the week-over-week baseline; the deliberate E2EE boundary, ADR 0054).
 *             A read-modify-write over ~400 days of history, so a flaky read is
 *             `failed`, NEVER mistaken for absent — overwriting the index off a
 *             transient error would erase the record (the keystore lesson).
 * - `tft`   — the self-recorded TFT LP-history point (ADR 0082). Riot exposes no
 *             LP history, so the hub snapshots today's ladder standing itself, the
 *             same read-modify-write discipline as the reading index (a flaky read
 *             is `failed`, never absent). It NEVER records sample or unranked data —
 *             a fabricated LP row would poison the series.
 * - `swept` — the count of expired fragment-key share envelopes reaped (ADR 0058).
 *             It piggybacks on this already-authorized nightly run;
 *             `sweepExpiredShares` never throws, but a defensive `catch → -1`
 *             keeps a sweep hiccup from sinking the snapshot.
 *
 * Runs late each Sydney evening via Vercel Cron (vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; required, fail-closed in production
 * (lib/cron-auth). Every store is guarded, so one that's off no-ops cleanly.
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

/** Merge today's ladder standing into the plaintext LP history (read-modify-write). */
async function writeTftHistory(
  tft: Awaited<ReturnType<typeof getTft>>,
  raw: Awaited<ReturnType<typeof getTftHistoryRaw>>,
  date: string,
): Promise<Outcome> {
  // Never record sample/unranked data — a fabricated LP row would poison the series.
  if (!tft.isLive || !tft.rank) return "skipped";

  // A flaky read must NEVER read as absent: this rewrites the whole history, so an
  // error-as-empty would clobber the recorded days with a single fresh entry.
  if (raw.state === "error") return "failed";

  let history: TftHistory;
  if (raw.state === "absent") {
    history = { v: 1, days: [] };
  } else {
    try {
      const parsed: unknown = JSON.parse(raw.value);
      if (!isTftHistory(parsed))
        throw new Error("tft history: unrecognized shape");
      history = parsed;
    } catch (err) {
      // Don't overwrite something we can't recognize.
      console.error("[cron:snapshot] tft history parse failed:", err);
      return "failed";
    }
  }

  const next = upsertHistoryDay(history, {
    date,
    tier: tft.rank.tier,
    division: tft.rank.division,
    lp: tft.rank.lp,
    games: tft.gamesThisSet,
  });
  return (await putTftHistory(JSON.stringify(next))) ? "written" : "failed";
}

export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const date = sydneyToday();
  const [reading, snapIndex, tftStats, tftHistory] = await Promise.all([
    getCurrentlyReading(),
    getSnapIndex(),
    getTft(),
    getTftHistoryRaw(),
  ]);

  const [index, tft, swept] = await Promise.all([
    writeIndex(reading, snapIndex, date),
    writeTftHistory(tftStats, tftHistory, date),
    // A sweep failure must never fail the snapshot (the sweep never throws anyway).
    sweepExpiredShares(Math.floor(Date.now() / 1000)).catch(() => -1),
  ]);

  return Response.json({
    date,
    index,
    tft,
    swept,
    at: new Date().toISOString(),
  });
}
