import { TftStrip } from "@/components/TftStrip";
import { Sparkline } from "@/components/terminal/Sparkline";
import { relativeTime } from "@/lib/github";
import {
  ladderValue,
  rankLabel,
  type TftHistoryDay,
  type TftStats,
} from "@/lib/tft";

/**
 * The lobby's "arena" band — the live TFT ladder signal for recruiters (ADR 0082).
 * A full-width strip below the code band: rank + top-4 rate + the recent ranked
 * placements, coloured by finish. All public data. Not an anchor — TFT has no
 * canonical public profile URL to link out to (ADR 0082).
 */

export function TftModule({
  tft,
  history = [],
}: {
  tft: TftStats;
  history?: TftHistoryDay[];
}) {
  // One comparable number per day so the line reads as a single climb across tiers.
  const ladder = history.map((d) => ladderValue(d.tier, d.division, d.lp));
  return (
    <div className="block border-t border-hairline px-4 py-4">
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.2em] text-muted">
          <span className="h-2 w-2 rounded-full bg-up" />
          <span>tft</span>
          <span className="normal-case tracking-normal text-muted/70">
            · {tft.riotId}
          </span>
        </div>
        {tft.setNumber ? (
          <span className="text-xs text-muted">set {tft.setNumber}</span>
        ) : null}
      </div>

      {/* stats */}
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-2">
        <Stat value={rankLabel(tft.rank)} sub="ranked tft" amber />
        {tft.top4Rate != null ? (
          <Stat
            value={`${tft.top4Rate}%`}
            sub={`top-4 rate · last ${tft.placements.length}`}
          />
        ) : null}
        {tft.avgPlacement != null ? (
          <Stat value={tft.avgPlacement.toFixed(1)} sub="avg place" />
        ) : null}
        {tft.gamesThisSet != null ? (
          <Stat
            value={tft.gamesThisSet.toLocaleString()}
            sub="games this set"
          />
        ) : null}
      </div>

      {/* recent placements — tap a cell for that game's comp (TftStrip island) */}
      {tft.placements.length > 0 && (
        <TftStrip placements={tft.placements} games={tft.recent} />
      )}

      {/* ladder trend — self-recorded LP history (ADR 0082) */}
      {ladder.length >= 2 && (
        <div className="mt-4">
          <Sparkline
            values={ladder}
            delta={ladder[ladder.length - 1] - ladder[0]}
            label="tft ladder trend"
          />
          <p className="mt-1 text-xs text-muted">
            lp · last {history.length} days
          </p>
        </div>
      )}

      {/* last game */}
      {tft.lastPlayedAt && (
        <p className="mt-3 text-xs text-muted">
          last game {relativeTime(tft.lastPlayedAt)}
        </p>
      )}
    </div>
  );
}

function Stat({
  value,
  sub,
  amber,
}: {
  value: string;
  sub: string;
  amber?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-2xl tabular-nums ${amber ? "text-amber" : "text-fg"}`}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted">{sub}</div>
    </div>
  );
}
