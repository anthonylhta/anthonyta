import { sparkGeometry } from "@/lib/spark";
import { tone } from "@/lib/money";

/**
 * A small, dependency-free area sparkline. Presentational only — geometry is the
 * pure `sparkGeometry`, color rides `currentColor` off `tone(delta)` (green up /
 * red down / muted flat — the only place the palette allows green & red is finance,
 * ADR 0002). The SVG scales to its container via the viewBox; callers gate on
 * `values.length >= 2`.
 */
export function Sparkline({
  values,
  delta,
  width = 320,
  height = 48,
  label = "net worth trend",
  marker,
}: {
  values: number[];
  /** Sign decides the line color; usually `last - first`. */
  delta: number;
  width?: number;
  height?: number;
  /** aria-label for the plot; defaults to the net-worth call sites' wording. */
  label?: string;
  /** Index of the point to mark instead of the end — a scrubber's cursor. The
   *  dot moves there and a hairline drops through it; out of range = the end. */
  marker?: number;
}) {
  const { line, area, points } = sparkGeometry(values, width, height, 3);
  const at =
    marker !== undefined && marker >= 0 && marker < points.length
      ? points[marker]
      : points[points.length - 1];
  const scrubbing = at !== undefined && at !== points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-12 w-full ${tone(delta)}`}
      role="img"
      aria-label={label}
    >
      <path d={area} fill="currentColor" fillOpacity={0.08} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {scrubbing && (
        <line
          x1={at.x}
          y1={0}
          x2={at.x}
          y2={height}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {at && <circle cx={at.x} cy={at.y} r={2.5} fill="currentColor" />}
    </svg>
  );
}
