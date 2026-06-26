/**
 * A single-row activity heatmap — the trailing daily levels for one domain in the
 * command center's "this week" zone (ADR 0044). Pure SVG; amber intensity (the
 * dashboard's accent), faint warm square for empty days. Stretches to fill its
 * column via the viewBox.
 */
const LEVELS = [
  "#1b1711",
  "rgba(245,165,36,0.26)",
  "rgba(245,165,36,0.5)",
  "rgba(245,165,36,0.75)",
  "#f5a524",
];

const STEP = 6;
const CW = 4.6;

export function ActivityStrip({ levels }: { levels: number[] }) {
  const w = Math.max(1, levels.length) * STEP;
  return (
    <svg
      viewBox={`0 0 ${w} 13`}
      preserveAspectRatio="none"
      className="h-3.5 w-full"
      role="img"
      aria-label="activity, last 10 weeks"
    >
      {levels.map((lvl, i) => (
        <rect
          key={i}
          x={i * STEP}
          y={0}
          width={CW}
          height={13}
          rx={1.2}
          fill={LEVELS[lvl] ?? LEVELS[0]}
        />
      ))}
    </svg>
  );
}
