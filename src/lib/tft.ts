/**
 * Pure TFT transforms + types — the Riot match payload → the normalized shape the
 * lobby renders (ADR 0082). Kept free of any `next` import so it's unit-testable on
 * its own (mirrors lib/github vs connectors/github); the connector (connectors/tft)
 * wraps these around the fetch + cache.
 */

/** A single league entry from tft/league/v1 — trimmed to what the ladder needs. */
export interface RawLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

/** A match from tft/match/v1 — Riot's payload is snake_case; trimmed to fields used. */
export interface RawMatch {
  info: {
    game_datetime: number;
    queue_id?: number;
    queueId?: number;
    tft_set_number?: number;
    participants: { puuid: string; placement: number }[];
  };
}

export interface TftStats {
  /** "Name#TAG" display */
  riotId: string;
  /** null = unranked / league read failed */
  rank: { tier: string; division: string | null; lp: number } | null;
  /** league wins + losses (Riot counts a TFT "win" as a top-4) */
  gamesThisSet: number | null;
  /** ranked-only placements, oldest → newest, ≤20 */
  placements: number[];
  /** 0–100 rounded; null when no ranked games in the window */
  top4Rate: number | null;
  /** 1 decimal; null when none */
  avgPlacement: number | null;
  /** ranked games in the trailing 7×24h */
  gamesThisWeek: number;
  /** ISO timestamps, ranked-only, oldest → newest — feeds activity.dailyCounts */
  matchDates: string[];
  /** ISO of the newest ranked game */
  lastPlayedAt: string | null;
  /** tft_set_number of the newest ranked game */
  setNumber: number | null;
  /** false when served from SAMPLE (no key / read failed) */
  isLive: boolean;
}

/** Riot's TFT ranked queue id — hyper roll (1130), double up (1160), normals excluded. */
const RANKED_QUEUE = 1100;

/** Tiers where there's no division to show (a single LP ladder above Diamond). */
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

/** A placement → its ladder bucket: 1st / a top-4 finish / bottom half. */
export function placementBucket(
  placement: number,
): "first" | "top4" | "bottom4" {
  if (placement === 1) return "first";
  if (placement <= 4) return "top4";
  return "bottom4";
}

/** A rank → a display label: "Master · 21 LP", "Diamond II · 63 LP", "unranked". */
export function rankLabel(rank: TftStats["rank"]): string {
  if (!rank) return "unranked";
  const tier =
    rank.tier.charAt(0).toUpperCase() + rank.tier.slice(1).toLowerCase();
  const division =
    rank.division && !APEX.has(rank.tier.toUpperCase())
      ? ` ${rank.division}`
      : "";
  return `${tier}${division} · ${rank.lp} LP`;
}

/** League entry + recent matches → the normalized shape the module renders. */
export function summarizeTft(
  entry: RawLeagueEntry | null,
  matches: RawMatch[],
  ctx: { puuid: string; riotId: string; now?: number },
): TftStats {
  const now = ctx.now ?? Date.now();

  // Keep only ranked games the owner actually played in. `queueId` hedges a proxy
  // or a Riot rename of the snake_case field. The ids endpoint returns newest-first,
  // so we sort ascending → placements / dates come out oldest → newest.
  const ranked: { placement: number; datetime: number; set: number | null }[] =
    [];
  for (const m of matches) {
    const queue = m.info.queue_id ?? m.info.queueId;
    if (queue !== RANKED_QUEUE) continue;
    const self = m.info.participants.find((p) => p.puuid === ctx.puuid);
    if (!self) continue;
    ranked.push({
      placement: self.placement,
      datetime: m.info.game_datetime,
      set: m.info.tft_set_number ?? null,
    });
  }
  ranked.sort((a, b) => a.datetime - b.datetime);

  const placements = ranked.map((r) => r.placement);
  const matchDates = ranked.map((r) => new Date(r.datetime).toISOString());
  const n = placements.length;
  const top4 = placements.filter((p) => p <= 4).length;
  const weekStart = now - 7 * 86_400_000;
  const newest = ranked[ranked.length - 1] ?? null;

  const rank = entry
    ? {
        tier: entry.tier,
        division: APEX.has(entry.tier.toUpperCase()) ? null : entry.rank,
        lp: entry.leaguePoints,
      }
    : null;

  return {
    riotId: ctx.riotId,
    rank,
    gamesThisSet: entry ? entry.wins + entry.losses : null,
    placements,
    top4Rate: n ? Math.round((100 * top4) / n) : null,
    avgPlacement: n
      ? Math.round((placements.reduce((a, b) => a + b, 0) / n) * 10) / 10
      : null,
    gamesThisWeek: ranked.filter((r) => r.datetime >= weekStart).length,
    matchDates,
    lastPlayedAt: newest ? new Date(newest.datetime).toISOString() : null,
    setNumber: newest ? newest.set : null,
    isLive: true,
  };
}

// ── LP history (self-recorded; Riot exposes no LP-history endpoint) ──────────

/** One day's ladder standing, snapshotted nightly by the cron (ADR 0082). `games`
 *  is that day's league wins+losses; null when the league read didn't report it. */
export interface TftHistoryDay {
  date: string;
  tier: string;
  division: string | null;
  lp: number;
  games: number | null;
}
/** The self-recorded LP-history series — days ascending, one per day, trimmed. */
export interface TftHistory {
  v: 1;
  days: TftHistoryDay[];
}

/** How many days of LP history we retain before trimming the oldest. */
const TFT_HISTORY_MAX_DAYS = 400;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function isYmd(x: unknown): x is string {
  return typeof x === "string" && YMD.test(x);
}
/** A safe integer ≥ 0. */
function isNonNegInt(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

/** Strict guard for a stored LP history (mirrors isSnapIndex): `v === 1`, a days
 *  array of at most 500 (the 400 trim cap plus slack), each a dated row with a
 *  bounded tier, null-or-string division, non-negative LP, null-or-count games, and
 *  dates strictly ascending. */
export function isTftHistory(x: unknown): x is TftHistory {
  if (!isObj(x) || x.v !== 1 || !Array.isArray(x.days)) return false;
  if (x.days.length > 500) return false;
  let prev = "";
  for (const d of x.days) {
    if (!isObj(d)) return false;
    if (!isYmd(d.date)) return false;
    if (typeof d.tier !== "string" || d.tier.length === 0 || d.tier.length > 20)
      return false;
    if (
      !(
        d.division === null ||
        (typeof d.division === "string" && d.division.length <= 4)
      )
    )
      return false;
    if (!isNonNegInt(d.lp)) return false;
    if (!(d.games === null || isNonNegInt(d.games))) return false;
    if (!(d.date > prev)) return false; // strictly ascending (prev "" first)
    prev = d.date;
  }
  return true;
}

/** Insertion index that keeps `days` ascending — the first slot whose date is
 *  greater than `date`, or the end. */
function insertAt(days: { date: string }[], date: string): number {
  const i = days.findIndex((e) => e.date > date);
  return i < 0 ? days.length : i;
}

/** A new history with `day` merged in (replace-or-insert, ascending), then trimmed
 *  to the last TFT_HISTORY_MAX_DAYS. The input history is never mutated. */
export function upsertHistoryDay(
  h: TftHistory,
  day: TftHistoryDay,
): TftHistory {
  const kept = h.days.filter((d) => d.date !== day.date);
  const at = insertAt(kept, day.date);
  const merged = [...kept.slice(0, at), day, ...kept.slice(at)];
  return { v: 1, days: merged.slice(-TFT_HISTORY_MAX_DAYS) };
}

/** Per-tier ladder base — 400 apart so a full IV→I climb (offsets 0–399) never
 *  crosses into the next tier's band. The three apex tiers share one base: above
 *  Diamond it's a single continuous LP ladder with no divisions. */
const TIER_BASE: Record<string, number> = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
  MASTER: 2800,
  GRANDMASTER: 2800,
  CHALLENGER: 2800,
};
/** Division → its offset within a tier's band (IV lowest, I highest). */
const DIVISION_OFFSET: Record<string, number> = {
  IV: 0,
  III: 100,
  II: 200,
  I: 300,
};

/**
 * A rank → one monotonic number that stays comparable ACROSS tier crossings, so the
 * sparkline reads as a single climb (Diamond I 99 LP < Master 0 LP). base + the
 * division's offset + LP, case-insensitive; an unknown tier falls back to base 0.
 * Apex tiers carry no division (null → 0 offset) since they're one continuous ladder.
 */
export function ladderValue(
  tier: string,
  division: string | null,
  lp: number,
): number {
  const base = TIER_BASE[tier.toUpperCase()] ?? 0;
  const offset = division ? (DIVISION_OFFSET[division.toUpperCase()] ?? 0) : 0;
  return base + offset + lp;
}

// ── sample fallback (deterministic, so it doesn't flicker between requests) ───

/** Shown when the Riot key / riot-id isn't set (CI, local) or a read fails. Not real
 *  data — the clock-free fields stay static so nothing shifts between requests. */
export const sampleTft: TftStats = {
  riotId: "anthonyta#OCE",
  rank: { tier: "MASTER", division: null, lp: 21 },
  gamesThisSet: 312,
  placements: [4, 1, 3, 6, 2, 4, 1, 5, 2, 3, 7, 4, 2, 1, 8, 3, 4, 2, 5, 3],
  top4Rate: 75,
  avgPlacement: 3.5,
  gamesThisWeek: 0,
  matchDates: [],
  lastPlayedAt: null,
  setNumber: null,
  isLive: false,
};
