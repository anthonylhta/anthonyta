import { overdueChores } from "@/lib/chores";
import { getChoreReads } from "@/lib/connectors/chores";
import { probeHealth } from "@/lib/connectors/health";
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
import { classifyHealth, HEALTH_TARGETS } from "@/lib/health";
import {
  categoryOn,
  checkChoresDigest,
  checkHealthDown,
  checkStaleness,
  INGEST_SOURCES,
  parsePushConfig,
  pruneSubs,
  serializePushConfig,
  setEpisode,
  setHealth,
  stalenessBody,
  type IngestSource,
  type PushConfig,
} from "@/lib/push";
import { deliver, pushConfigured } from "@/lib/pushsend";
import { getPushRaw, putPush } from "@/lib/pushstore";
import { sweepExpiredShares } from "@/lib/shares";
import { parseSleepStore } from "@/lib/sleep";
import { getSleepRaw } from "@/lib/sleepstore";
import { parseStepsStore } from "@/lib/steps";
import { getStepsRaw } from "@/lib/stepsstore";
import { isTftHistory, upsertHistoryDay, type TftHistory } from "@/lib/tft";
import { getTftHistoryRaw, putTftHistory } from "@/lib/tftstore";

export const dynamic = "force-dynamic";

/**
 * Nightly cron. Six jobs (the sealed-box net-worth snapshot retired with ADR 0061
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
 * - `alarm` — the ingest-staleness push: the phone pushes steps and sleep, and
 *             nothing else notices when it quietly stops. Once per silence
 *             episode, never off a read error, and never for a store that has
 *             had no data yet (lib/push's `checkStaleness` owns the rules).
 * - `upkeep`— the maintenance digest: one line naming the chores that have gone
 *             WELL overdue and the command each needs. Server-visible evidence
 *             only (the finance chip's lives in an envelope), the red state
 *             only, and at most weekly while it stays red (`overdueChores` +
 *             `checkChoresDigest` own the rules).
 * - `health` — the project-health tripwire: the sibling projects get probed
 *             uncached, and two CONSECUTIVE failed nights buzz once per
 *             down-episode. A single failed probe is noise, which is why the
 *             debounce is the whole feature (`checkHealthDown` owns the rules).
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

/** The recorded-day map for one plaintext ingest source; `null` when the store
 *  couldn't be read, which `checkStaleness` turns into silence rather than an
 *  alarm — "I can't see it" is not "it stopped". */
async function recordedDays(
  source: IngestSource,
): Promise<Record<string, number> | null> {
  try {
    if (source === "steps") {
      const read = await getStepsRaw();
      if (read.state === "error") return null;
      return read.state === "absent" ? {} : parseStepsStore(read.value).days;
    }
    const read = await getSleepRaw();
    if (read.state === "error") return null;
    return read.state === "absent" ? {} : parseSleepStore(read.value).nights;
  } catch (err) {
    console.error(`[cron:snapshot] ${source} read failed:`, err);
    return null;
  }
}

/** Notify the owner about ingests that have gone quiet, at most once per silence.
 *  One write folds the episode stamps and any dead-subscription prune together,
 *  so the send can't race the bookkeeping. */
async function alarmStaleIngests(date: string): Promise<Outcome> {
  if (!pushConfigured()) return "skipped";

  const read = await getPushRaw();
  // A flaky read must never read as absent here either: this rewrites the whole
  // config, so an error-as-empty would drop every enrolled device.
  if (read.state === "error") return "failed";
  if (read.state === "absent") return "skipped";
  const cfg = parsePushConfig(read.value);
  if (!categoryOn(cfg, "ingest")) return "skipped";

  let next: PushConfig = cfg;
  const alarms: string[] = [];
  for (const source of INGEST_SOURCES) {
    const verdict = checkStaleness(
      await recordedDays(source),
      date,
      cfg.episodes[source],
    );
    next = setEpisode(next, source, verdict.episode);
    if (verdict.alarm) alarms.push(stalenessBody(source, verdict.days));
  }

  for (const body of alarms)
    next = pruneSubs(next, await deliver(next, "ingest", body, "/"));

  const serialized = serializePushConfig(next);
  if (serialized !== serializePushConfig(cfg) && !(await putPush(serialized)))
    return "failed";
  return alarms.length > 0 ? "written" : "skipped";
}

/** Notify the owner about the hub's own upkeep once it is well behind, at most
 *  weekly. Same shape as the ingest alarm, and the same refusals: no VAPID, an
 *  unreadable config, or nobody enrolled is silence rather than an attempt.
 *  Evidence that couldn't be read arrives as "no record" from the connector,
 *  which is never overdue — an unreadable stamp says nothing about the chore. */
async function alarmOverdueChores(date: string): Promise<Outcome> {
  if (!pushConfigured()) return "skipped";

  const read = await getPushRaw();
  // Same read-modify-write discipline as above: an error must not read as
  // absent, or the write would drop every enrolled device.
  if (read.state === "error") return "failed";
  if (read.state === "absent") return "skipped";
  const cfg = parsePushConfig(read.value);
  if (!categoryOn(cfg, "chores")) return "skipped";

  const reads = await getChoreReads();
  const verdict = checkChoresDigest(
    overdueChores(
      {
        vaultSync: reads.vaultSyncedAt,
        backup: reads.backupAt,
        aperture: reads.apertureSealedAt,
      },
      new Date(),
    ),
    date,
    cfg.episodes.chores,
  );

  let next = setEpisode(cfg, "chores", verdict.episode);
  if (verdict.send)
    next = pruneSubs(next, await deliver(next, "chores", verdict.body, "/"));

  const serialized = serializePushConfig(next);
  if (serialized !== serializePushConfig(cfg) && !(await putPush(serialized)))
    return "failed";
  return verdict.send ? "written" : "skipped";
}

/** Notify the owner when a sibling project has failed its probe two nights
 *  running, once per down-episode. Same refusals as the two jobs above; the one
 *  difference is that a failing PROBE is not a failure here, it is the data.
 *  Probing is skipped entirely when nothing would be sent — the tripwire has no
 *  second purpose, so an off toggle costs the siblings nothing. */
async function alarmProjectsDown(): Promise<Outcome> {
  if (!pushConfigured()) return "skipped";

  const read = await getPushRaw();
  // Same read-modify-write discipline as above: an error must not read as
  // absent, or the write would drop every enrolled device.
  if (read.state === "error") return "failed";
  if (read.state === "absent") return "skipped";
  const cfg = parsePushConfig(read.value);
  if (!categoryOn(cfg, "health")) return "skipped";

  const probes = await Promise.all(
    HEALTH_TARGETS.map(async (t) => {
      const { ok, ms } = await probeHealth(t.url);
      return {
        key: t.key,
        label: t.label,
        down: classifyHealth(ok, ms) === "down",
      };
    }),
  );
  const verdict = checkHealthDown(probes, cfg.health);

  let next = setHealth(cfg, verdict.health);
  if (verdict.alarm)
    next = pruneSubs(next, await deliver(next, "health", verdict.body, "/"));

  const serialized = serializePushConfig(next);
  if (serialized !== serializePushConfig(cfg) && !(await putPush(serialized)))
    return "failed";
  return verdict.alarm ? "written" : "skipped";
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

  // The notification jobs read-modify-write the SAME config blob, so they run in
  // sequence: side by side, the later write would land on a config read before
  // the earlier one and quietly undo its episode stamp and its prune. None of
  // them may sink the jobs above — a courtesy is the last thing allowed to cost
  // the record.
  const alarm = await alarmStaleIngests(date).catch((err) => {
    console.error("[cron:snapshot] ingest alarm failed:", err);
    return "failed" as Outcome;
  });
  const upkeep = await alarmOverdueChores(date).catch((err) => {
    console.error("[cron:snapshot] upkeep digest failed:", err);
    return "failed" as Outcome;
  });
  const health = await alarmProjectsDown().catch((err) => {
    console.error("[cron:snapshot] health tripwire failed:", err);
    return "failed" as Outcome;
  });

  return Response.json({
    date,
    index,
    tft,
    swept,
    alarm,
    upkeep,
    health,
    at: new Date().toISOString(),
  });
}
