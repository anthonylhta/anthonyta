"use client";

import { useState } from "react";
import type { HandPuzzle } from "@/lib/connectors/riichi";
import {
  doraFromIndicator,
  isCorrectDiscard,
  tileLabel,
  type TileCode,
} from "@/lib/tiles";

type TileState = "idle" | "selected" | "best" | "wrong";

function Tile({
  code,
  state,
  onClick,
}: {
  code: TileCode;
  state: TileState;
  onClick?: () => void;
}) {
  const styles: Record<TileState, string> = {
    idle: "border-hairline text-fg hover:border-amber hover:text-amber",
    selected: "border-amber text-amber",
    best: "border-up text-up",
    wrong: "border-down text-down",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex h-12 w-9 items-center justify-center border bg-surface/40 text-sm tabular-nums transition-colors ${styles[state]}`}
    >
      {tileLabel(code)}
    </button>
  );
}

/**
 * Renders today's hand natively and lets you solve it inline: click a discard,
 * graded locally against the stored answer (read-only — nothing is written back).
 */
export function PuzzleCard({ puzzle }: { puzzle: HandPuzzle }) {
  const [picked, setPicked] = useState<number | null>(null);
  const revealed = picked !== null;
  const guess = picked !== null ? puzzle.hand[picked] : null;
  const correct =
    guess !== null && isCorrectDiscard(guess, puzzle.bestDiscards);

  function tileState(i: number, code: TileCode): TileState {
    if (!revealed) return picked === i ? "selected" : "idle";
    if (puzzle.bestDiscards.includes(code)) return "best";
    if (i === picked) return "wrong";
    return "idle";
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{puzzle.question}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          seat <span className="text-fg">{tileLabel(puzzle.seatWind)}</span>
        </span>
        <span>
          round <span className="text-fg">{tileLabel(puzzle.roundWind)}</span>
        </span>
        <span>
          dora{" "}
          <span className="text-fg">
            {tileLabel(doraFromIndicator(puzzle.doraIndicator))}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {puzzle.hand.map((code, i) => (
          <Tile
            key={i}
            code={code}
            state={tileState(i, code)}
            onClick={revealed ? undefined : () => setPicked(i)}
          />
        ))}
      </div>

      {!revealed && (
        <p className="text-xs text-muted">click the tile you&apos;d discard.</p>
      )}

      {revealed && (
        <div className="space-y-3 border-t border-hairline pt-4">
          <p className={`text-sm ${correct ? "text-up" : "text-down"}`}>
            {correct ? "正解 — correct" : "不正解 — not optimal"}
            {!correct && (
              <span className="text-muted">
                {" "}
                · best: {puzzle.bestDiscards.map(tileLabel).join(", ")}
              </span>
            )}
          </p>
          <p className="text-xs text-muted">
            leaves{" "}
            {puzzle.bestShanten === 0
              ? "tenpai"
              : `${puzzle.bestShanten}-shanten`}{" "}
            · accepts {puzzle.ukeire} tiles (
            {puzzle.ukeireTiles.map(tileLabel).join(" ")})
          </p>
          <p className="text-sm text-fg/90">{puzzle.explanation}</p>
          <div className="flex items-center gap-4 pt-1">
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-xs text-amber hover:underline"
            >
              try again
            </button>
            <a
              href="https://riichi.anthonyta.dev/hand-of-the-day"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted hover:text-amber"
            >
              open in riichi ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
