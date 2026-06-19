import postgres from "postgres";
import type { Connector } from "./types";
import type { TileCode } from "../tiles";

/**
 * riichi connector — reads today's Hand of the Day from the `riichi` project's
 * Neon DB (ADR 0003, 0007). READ-ONLY: only SELECTs the shared daily puzzle (one
 * row, same for everyone — no user data). The hub re-renders it natively and
 * grades locally against the stored answer; it never writes back. Streak tracking
 * stays in the riichi app until the hub has auth.
 *
 * Neon is dual-stack; on WSL its IPv6 stalls Node's connect — the `dev`/`build`
 * scripts carry `NODE_OPTIONS=--dns-result-order=ipv4first ...` to force IPv4
 * locally. Prod/Vercel unaffected.
 */

export interface HandPuzzle {
  date: string;
  hand: TileCode[];
  seatWind: TileCode;
  roundWind: TileCode;
  doraIndicator: TileCode;
  question: string;
  bestDiscards: TileCode[];
  bestShanten: number;
  ukeire: number;
  ukeireTiles: TileCode[];
  explanation: string;
  /** false when served from the built-in SAMPLE_PUZZLE (DB not configured). */
  isLive: boolean;
}

// The `puzzle` jsonb shape stored by riichi (src/lib/server/handOfTheDay.ts).
type PuzzleJson = Omit<HandPuzzle, "date" | "isLive">;
type Row = { date: string; puzzle: PuzzleJson };

/** Shown when RIICHI_DATABASE_URL isn't set (local dev without the string, CI). */
export const SAMPLE_PUZZLE: HandPuzzle = {
  date: "sample",
  hand: [1, 1, 2, 3, 4, 9, 14, 15, 16, 21, 22, 23, 25, 26],
  seatWind: 28,
  roundWind: 28,
  doraIndicator: 13,
  question:
    "You just drew your 14th tile. Which single tile is the most efficient discard?",
  bestDiscards: [9],
  bestShanten: 1,
  ukeire: 8,
  ukeireTiles: [24, 27],
  explanation:
    "Discard the lone 9m — it connects to nothing, while keeping 7s8s leaves a ryanmen and the 1m pair can still become a triplet, a clean 1-shanten. (Sample puzzle — set RIICHI_DATABASE_URL to read the live daily hand.)",
  isLive: false,
};

/** YYYY-MM-DD on the Sydney calendar day — riichi keys the puzzle this way. */
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

/** Today's Hand of the Day (falls back to the most recent day, then `null`). */
export async function getHandOfTheDay(): Promise<HandPuzzle | null> {
  const db = client();
  if (!db) return null;
  try {
    const today = sydneyDate();
    let rows = await db<Row[]>`
      select date, puzzle from hand_of_the_day where date = ${today} limit 1
    `;
    if (rows.length === 0) {
      rows = await db<Row[]>`
        select date, puzzle from hand_of_the_day order by date desc limit 1
      `;
    }
    const row = rows[0];
    if (!row) return null;
    return { date: row.date, ...row.puzzle, isLive: true };
  } catch (err) {
    console.error("[connector:riichi] read failed:", err);
    return null;
  }
}

export const riichi: Connector<HandPuzzle | null> = {
  key: "riichi",
  label: "hand of the day",
  fetch: () => getHandOfTheDay(),
};
