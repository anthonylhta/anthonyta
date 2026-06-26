import type { HandPuzzle } from "@/lib/connectors/riichi";
import { doraFromIndicator, tileLabel, type TileCode } from "@/lib/tiles";

/**
 * Renders today's hand natively, read-only. Display-only (ADR 0047): the answer
 * lives in the riichi app, so the hub shows the situation and links out to solve —
 * which is also where the streak is tracked.
 */
export function PuzzleCard({ puzzle }: { puzzle: HandPuzzle }) {
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
          <Tile key={i} code={code} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline pt-4">
        <a
          href="https://riichi.anthonyta.dev/hand-of-the-day"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-amber hover:underline"
        >
          solve in riichi ↗
        </a>
        <span className="text-xs text-muted">
          the answer + your streak live in the app
        </span>
      </div>
    </div>
  );
}

function Tile({ code }: { code: TileCode }) {
  return (
    <span className="flex h-12 w-9 items-center justify-center border border-hairline bg-surface/40 text-sm tabular-nums text-fg">
      {tileLabel(code)}
    </span>
  );
}
