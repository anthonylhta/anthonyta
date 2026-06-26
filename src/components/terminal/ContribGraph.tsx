/**
 * GitHub contribution heatmap — pure SVG, no library. Levels 0–4 map to the
 * palette's green (the one place green is allowed is live activity, ADR 0002);
 * empty cells are a faint warm square. Scales to its container via the viewBox.
 */
const LEVELS = [
  "#1b1711",
  "rgba(127,209,127,0.30)",
  "rgba(127,209,127,0.52)",
  "rgba(127,209,127,0.76)",
  "#7fd17f",
];

const STEP = 13;
const CELL = 10;
const LABEL_H = 16;

export function ContribGraph({
  weeks,
  months,
}: {
  weeks: number[][];
  months: { label: string; week: number }[];
}) {
  const w = weeks.length * STEP;
  const h = 7 * STEP + LABEL_H;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMinYMin meet"
      className="w-full"
      role="img"
      aria-label="GitHub contributions, last year"
    >
      {months.map((m) => (
        <text
          key={`${m.label}-${m.week}`}
          x={m.week * STEP}
          y={11}
          fill="#a39a86"
          fontSize={10}
          fontFamily="var(--font-geist-mono)"
        >
          {m.label}
        </text>
      ))}
      <g transform={`translate(0, ${LABEL_H})`}>
        {weeks.map((week, wi) =>
          week.map((lvl, di) => (
            <rect
              key={`${wi}-${di}`}
              x={wi * STEP}
              y={di * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              fill={LEVELS[lvl] ?? LEVELS[0]}
            />
          )),
        )}
      </g>
    </svg>
  );
}
