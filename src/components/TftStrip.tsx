"use client";

import { useState } from "react";
import { relativeTime } from "@/lib/github";
import { placementBucket, type TftGame } from "@/lib/tft";

/**
 * TftStrip — the arena band's recent-placement row as a client island (ADR 0082).
 * Each cell is one ranked game; tap it to unfold the comp behind that finish — traits
 * + units, text only (no Data Dragon assets, no CSP change). Sample mode has no real
 * comps (`games` empty), so it renders the same cells as plain, inert spans.
 */

/** placementBucket → the cell's text + hairline-quiet border colour. */
const CELL: Record<ReturnType<typeof placementBucket>, string> = {
  first: "border-amber/60 text-amber",
  top4: "border-up/50 text-up",
  bottom4: "border-down/50 text-down",
};

/** 1 → "1st", 2 → "2nd", … for the cell's aria-label. */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function TftStrip({
  placements,
  games,
}: {
  placements: number[];
  games: TftGame[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  // A cell is a drill-down button only when we have a comp for every placement.
  const interactive = games.length === placements.length && games.length > 0;
  const cell =
    "flex h-5 w-5 items-center justify-center border text-[10px] tabular-nums";

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {placements.map((p, i) =>
          interactive ? (
            <button
              key={i}
              type="button"
              aria-pressed={open === i}
              aria-label={`game ${i + 1}, placed ${ordinal(p)}`}
              onClick={() => setOpen((cur) => (cur === i ? null : i))}
              className={`${cell} cursor-pointer transition-colors hover:bg-fg/5 ${CELL[placementBucket(p)]} ${open === i ? "bg-fg/5" : ""}`}
            >
              {p}
            </button>
          ) : (
            <span key={i} className={`${cell} ${CELL[placementBucket(p)]}`}>
              {p}
            </span>
          ),
        )}
      </div>

      {/* the tapped game's comp — text idiom of the band (muted, mono numerals) */}
      {interactive && open !== null && games[open] && (
        <GameDetail game={games[open]} />
      )}
    </>
  );
}

function GameDetail({ game }: { game: TftGame }) {
  const rel = relativeTime(game.at);
  return (
    <div className="mt-2 text-xs text-muted tabular-nums">
      <div>
        <span className={CELL[placementBucket(game.placement)]}>
          #{game.placement}
        </span>
        {rel && <span> · {rel}</span>}
      </div>
      {game.traits.length > 0 && (
        <div className="mt-0.5">
          {game.traits
            .slice(0, 4)
            .map((t) => `${t.name} ${t.count}`)
            .join(" · ")}
        </div>
      )}
      {game.units.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
          {game.units.map((u, i) => (
            <span key={i}>
              {u.name} ★{u.stars}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
