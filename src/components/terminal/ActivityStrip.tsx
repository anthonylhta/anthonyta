/**
 * A single-row activity heatmap — the trailing daily levels for one domain (ADR
 * 0044; today the paths band's evidence strips). Pure SVG; intensity in the
 * sheet's `--essence` where the cultivation skin declares it (ADR 0118), the
 * house amber anywhere the variable is unset — the fallback IS the old colour,
 * so the strip needs no prop to know which page it is on. Faint warm square for
 * empty days. Stretches to fill its column via the viewBox.
 */
const EMPTY = "#1b1711";
const TONE = "var(--essence, #f5a524)";
const LEVEL_ALPHA = [0, 0.26, 0.5, 0.75, 1];

const STEP = 6;
const CW = 4.6;

export function ActivityStrip({
  levels,
  label = "activity, last 10 weeks",
}: {
  levels: number[];
  /** aria-label for the plot; defaults to the this-week rows' wording. */
  label?: string;
}) {
  const w = Math.max(1, levels.length) * STEP;
  return (
    <svg
      viewBox={`0 0 ${w} 13`}
      preserveAspectRatio="none"
      className="h-3.5 w-full"
      role="img"
      aria-label={label}
    >
      {levels.map((lvl, i) => {
        const alpha = LEVEL_ALPHA[lvl] ?? 0;
        return (
          <rect
            key={i}
            x={i * STEP}
            y={0}
            width={CW}
            height={13}
            rx={1.2}
            fill={alpha === 0 ? EMPTY : TONE}
            fillOpacity={alpha === 0 ? 1 : alpha}
          />
        );
      })}
    </svg>
  );
}
