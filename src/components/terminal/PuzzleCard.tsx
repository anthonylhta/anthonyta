import type { HandPuzzle } from "@/lib/connectors/riichi";
import { doraFromIndicator, tileLabel, type TileCode } from "@/lib/tiles";

/** Where a guest goes to actually play today's hand — the riichi app, which
 *  holds the answer and tracks the streak (ADR 0047). One constant so the page
 *  and the lobby tile can't point different ways. */
export const HAND_OF_THE_DAY_URL =
  "https://riichi.anthonyta.dev/hand-of-the-day";

/**
 * Renders today's hand natively, read-only. Display-only (ADR 0047): the answer
 * lives in the riichi app, so the hub shows the situation and links out to solve —
 * which is also where the streak is tracked.
 */
export function PuzzleCard({ puzzle }: { puzzle: HandPuzzle }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{puzzle.question}</p>

      <Situation puzzle={puzzle} />

      <div className="flex flex-wrap gap-1">
        {puzzle.hand.map((code, i) => (
          <Tile key={i} code={code} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline pt-4">
        <a
          href={HAND_OF_THE_DAY_URL}
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

/**
 * The lobby's compact rendering of the same puzzle: the fourteen tiles in two
 * explicit rows of seven, over the situation line. Seven full-size tiles need
 * 276px and a lobby column's interior is 215px, so the box is the /riichi tile
 * at ¾ scale; the grid is explicit so a phone never gets a ragged wrap. The
 * question line stays with the caller — the lobby's teaser is shorter than the
 * puzzle's own wording.
 */
export function MiniHand({ puzzle }: { puzzle: HandPuzzle }) {
  return (
    <div className="space-y-2">
      <div className="grid w-max grid-cols-7 gap-0.5">
        {puzzle.hand.map((code, i) => (
          <Tile key={i} code={code} size="sm" />
        ))}
      </div>
      <Situation puzzle={puzzle} />
    </div>
  );
}

/** seat · round · dora — the line both renderings print, so they can't drift. */
function Situation({ puzzle }: { puzzle: HandPuzzle }) {
  return (
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
  );
}

function Tile({ code, size = "md" }: { code: TileCode; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-7 text-xs" : "h-12 w-9 text-sm";
  return (
    <span
      className={`flex ${box} items-center justify-center border border-hairline bg-surface/40 tabular-nums text-fg`}
    >
      {tileLabel(code)}
    </span>
  );
}
