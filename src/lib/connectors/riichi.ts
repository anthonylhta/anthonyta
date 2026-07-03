import postgres from "postgres";
import { ACTIVITY_DAYS } from "@/lib/activity";
import { riichiStats, sampleRiichiStats, type RiichiStats } from "@/lib/riichi";
import type { Connector } from "./types";
import type { TileCode } from "../tiles";

/**
 * riichi connector (ADR 0003, 0007, 0046, 0047). Two read-only reads:
 *
 *  - `getHandOfTheDay` — today's hand, fetched ANSWER-STRIPPED from riichi's public
 *    `GET /api/hand-of-the-day` (riichi ADR 0074). DISPLAY-ONLY: the answer stays in
 *    the app, so the hub shows the hand and links out to solve. (The old
 *    `hand_of_the_day` table this used to read was abandoned upstream — riichi
 *    ADR 0073 — which is why it had frozen.)
 *  - `getRiichiStats` — the OWNER's streak + solve history from the `puzzle_results`
 *    table (the same one riichi's own streak reads). Owner-only; behind auth.
 *
 * Neon is dual-stack; on WSL its IPv6 stalls Node's connect — the `dev`/`build`
 * scripts carry `NODE_OPTIONS=--dns-result-order=ipv4first ...`. Prod/Vercel unaffected.
 */

const RIICHI_URL = process.env.RIICHI_URL ?? "https://riichi.anthonyta.dev";

export interface HandPuzzle {
  date: string;
  hand: TileCode[];
  seatWind: TileCode;
  roundWind: TileCode;
  doraIndicator: TileCode;
  question: string;
  /** false when the live fetch failed and SAMPLE_PUZZLE is shown. */
  isLive: boolean;
}

/** The answer-stripped shape riichi's GET returns under `puzzle`. */
type PublicPuzzleResponse = {
  date: string;
  puzzle: Omit<HandPuzzle, "date" | "isLive">;
};

/** Shown when the live hand can't be fetched (offline, CI). Not the real daily hand. */
export const SAMPLE_PUZZLE: HandPuzzle = {
  date: "sample",
  hand: [1, 1, 2, 3, 4, 9, 14, 15, 16, 21, 22, 23, 25, 26],
  seatWind: 28,
  roundWind: 28,
  doraIndicator: 13,
  question:
    "You just drew your 14th tile. Which single tile is the most efficient discard?",
  isLive: false,
};

/**
 * Today's hand, fetched answer-stripped from riichi's public endpoint. `null` on any
 * failure → the page falls back to SAMPLE_PUZZLE. Cached 5 min (the hand changes once
 * a day), refreshable via the "riichi-hand" tag.
 */
export async function getHandOfTheDay(): Promise<HandPuzzle | null> {
  try {
    const res = await fetch(`${RIICHI_URL}/api/hand-of-the-day`, {
      next: { revalidate: 300, tags: ["riichi-hand"] },
    });
    if (!res.ok) {
      console.error("[connector:riichi] hand http", res.status);
      return null;
    }
    const data = (await res.json()) as PublicPuzzleResponse;
    if (!data?.puzzle?.hand?.length) return null;
    return { date: data.date, ...data.puzzle, isLive: true };
  } catch (err) {
    console.error("[connector:riichi] hand fetch failed:", err);
    return null;
  }
}

/** YYYY-MM-DD on the Sydney calendar day — riichi keys solves this way. */
function sydneyDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

let sql: ReturnType<typeof postgres> | null = null;
function client() {
  if (sql) return sql;
  const url = process.env.RIICHI_DATABASE_URL;
  if (!url) return null;
  sql = postgres(url, {
    prepare: false,
    ssl: "require",
    max: 1,
    idle_timeout: 20,
  });
  return sql;
}

/**
 * The owner's riichi streak + a trailing solve history for the command center pulse
 * (ADR 0046). Reads `puzzle_results` directly — the same per-user/day table riichi's
 * own streak reads. OWNER-ONLY: personal solve data, so the caller (command center)
 * is already behind auth. Guarded: no DB or no `RIICHI_USER_ID` (the serial
 * `users.id`) → sample.
 */
export async function getRiichiStats(): Promise<RiichiStats> {
  try {
    const db = client();
    const userId = Number(process.env.RIICHI_USER_ID);
    if (!db || !Number.isInteger(userId) || userId <= 0)
      return sampleRiichiStats;
    const rows = await db<{ date: string; correct: boolean }[]>`
      select date, correct from puzzle_results where user_id = ${userId}
    `;
    return riichiStats(rows, sydneyDate(), ACTIVITY_DAYS);
  } catch (err) {
    console.error("[connector:riichi] stats read failed:", err);
    return sampleRiichiStats;
  }
}

export const riichi: Connector<HandPuzzle | null> = {
  key: "riichi",
  label: "hand of the day",
  fetch: () => getHandOfTheDay(),
};
