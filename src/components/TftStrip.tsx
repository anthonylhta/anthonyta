"use client";

import { useMemo, useState } from "react";
import { relativeTime } from "@/lib/github";
import {
  compTable,
  placementBucket,
  type TftCompTable,
  type TftGame,
} from "@/lib/tft";

/**
 * TftStrip — the arena band's recent-placement row as a client island (ADR 0082).
 * Each cell is one ranked game; tap it to unfold the comp behind that finish — traits
 * + units, text only (no Data Dragon assets, no CSP change). Sample mode has no real
 * comps (`games` empty), so it renders the same cells as plain, inert spans.
 *
 * Below the strip, a "comps · last n" toggle unfolds the per-comp fold of the same
 * games (ADR 0163) — the aggregation the tap-a-cell drill-down can't show. Closed by
 * default so the band keeps its height; absent entirely in sample mode.
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
  const [compsOpen, setCompsOpen] = useState(false);
  // A cell is a drill-down button only when we have a comp for every placement.
  const interactive = games.length === placements.length && games.length > 0;
  const comps = useMemo(() => compTable(games), [games]);
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

      {/* comps fold — closed by default so the band keeps its height (ADR 0163) */}
      {interactive && (
        <button
          type="button"
          aria-expanded={compsOpen}
          onClick={() => setCompsOpen((cur) => !cur)}
          className="mt-4 block cursor-pointer text-xs text-muted transition-colors hover:text-fg"
        >
          comps · last {games.length}{" "}
          <span className="text-muted/70">{compsOpen ? "▾" : "▸"}</span>
        </button>
      )}
      {interactive && compsOpen && <CompTable comps={comps} />}
    </>
  );
}

/** avg-place colour: green ≤3.0, red ≥5.0, plain between (the buckets' spirit). */
function avgClass(avg: number): string {
  if (avg <= 3) return "text-up";
  if (avg >= 5) return "text-down";
  return "text-fg";
}

function CompTable({ comps }: { comps: TftCompTable }) {
  return (
    <div className="mt-2 tabular-nums">
      {comps.rows.map((r) => (
        <div
          key={r.name}
          className="flex items-center gap-2 py-[3px] text-[11px] sm:gap-3 sm:text-xs"
        >
          <span className="w-[118px] shrink-0 truncate text-fg sm:w-[148px]">
            {r.name}
            {r.hint && <span className="text-muted"> · {r.hint}</span>}
          </span>
          <span className="w-[30px] shrink-0 text-right text-muted sm:w-[84px]">
            {r.placements.length}
            <span className="hidden sm:inline"> games</span>
            <span className="sm:hidden">g</span>
          </span>
          <span
            className={`w-[46px] shrink-0 text-right sm:w-[56px] ${avgClass(r.avg)}`}
          >
            {r.avg.toFixed(1)}
          </span>
          <span className="flex flex-wrap gap-[3px]">
            {r.placements.map((p, i) => (
              <span
                key={i}
                className={`flex h-4 w-4 items-center justify-center border text-[9px] ${CELL[placementBucket(p)]}`}
              >
                {p}
              </span>
            ))}
          </span>
        </div>
      ))}
      {comps.oneOffs.length > 0 && (
        <p className="pt-1 text-[11px] text-muted">
          + {comps.oneOffs.length} one-off
          {comps.oneOffs.length > 1 ? "s" : ""} ·{" "}
          {comps.oneOffs
            .map((o) => `${o.name} ${ordinal(o.placement)}`)
            .join(" · ")}
        </p>
      )}
    </div>
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
