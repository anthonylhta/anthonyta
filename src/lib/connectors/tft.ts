import { unstable_cache } from "next/cache";
import {
  sampleTft,
  summarizeTft,
  type RawLeagueEntry,
  type RawMatch,
  type TftStats,
} from "@/lib/tft";
import type { Connector } from "./types";

/**
 * tft connector — the live TFT ladder signal for the recruiter audience (ADR 0082).
 * READ-ONLY, PUBLIC data only: rank, recent ranked placements, set totals.
 *
 * Riot splits TFT across two hosts: the league read hits the PLATFORM host (`oc1`),
 * the account + match reads hit the REGIONAL cluster (`sea`/`americas`). OCE lives
 * awkwardly across both — which cluster answers is a Riot-side call, so the region
 * is a plain env (`RIOT_TFT_REGION`), not baked in: a wrong guess is an env flip,
 * not a redeploy (ADR 0082). The key is server-side only. Cached at the data layer
 * (tag "tft", 1h). Fully guarded: no key / no riot-id / any failure → `sampleTft`.
 */

/** One Riot GET with the key header. Non-2xx / no key → log which call, return null. */
async function riot<T>(url: string, label: string): Promise<T | null> {
  const key = process.env.RIOT_API_KEY;
  if (!key) return null;
  const res = await fetch(url, { headers: { "X-Riot-Token": key } });
  if (!res.ok) {
    console.error("[connector:tft] http", res.status, label);
    return null;
  }
  return (await res.json()) as T;
}

const load = unstable_cache(
  async (riotId: string): Promise<TftStats> => {
    const platform = process.env.RIOT_TFT_PLATFORM ?? "oc1";
    const region = process.env.RIOT_TFT_REGION ?? "sea";

    const [gameName, tagLine] = riotId.split("#");
    if (!tagLine) {
      console.error(
        "[connector:tft] malformed RIOT_TFT_RIOT_ID (need Name#TAG)",
      );
      return sampleTft;
    }

    // account-v1 is account-scoped — any regional cluster answers, americas is fine
    // globally — and is the only way to turn a riot-id into a puuid.
    const account = await riot<{
      puuid: string;
      gameName: string;
      tagLine: string;
    }>(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      "account",
    );
    if (!account) return sampleTft;

    const [league, ids] = await Promise.all([
      riot<RawLeagueEntry[]>(
        `https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${account.puuid}`,
        "league",
      ),
      riot<string[]>(
        `https://${region}.api.riotgames.com/tft/match/v1/matches/by-puuid/${account.puuid}/ids?count=20`,
        "match ids",
      ),
    ]);

    const entry = league?.find((e) => e.queueType === "RANKED_TFT") ?? null;
    const matches = (
      await Promise.all(
        (ids ?? []).map((id) =>
          riot<RawMatch>(
            `https://${region}.api.riotgames.com/tft/match/v1/matches/${id}`,
            "match",
          ),
        ),
      )
    ).filter((m): m is RawMatch => m !== null);

    if (!entry && matches.length === 0) return sampleTft;
    return summarizeTft(entry, matches, {
      puuid: account.puuid,
      riotId: `${account.gameName}#${account.tagLine}`,
    });
  },
  ["tft"],
  { revalidate: 3600, tags: ["tft"] },
);

/** Public TFT ladder for the lobby. Falls back to sample on no env / failure. */
export async function getTft(): Promise<TftStats> {
  const riotId = process.env.RIOT_TFT_RIOT_ID;
  if (!process.env.RIOT_API_KEY || !riotId) return sampleTft;
  try {
    return await load(riotId);
  } catch (err) {
    console.error("[connector:tft] read failed:", err);
    return sampleTft;
  }
}

export const tft: Connector<TftStats> = {
  key: "tft",
  label: "tft",
  fetch: () => getTft(),
};
