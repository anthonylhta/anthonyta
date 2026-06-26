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
}: {
  values: number[];
  /** Sign decides the line color; usually `last - first`. */
  delta: number;
  width?: number;
  height?: number;
}) {
  const { line, area, points } = sparkGeometry(values, width, height, 3);
  const end = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-12 w-full ${tone(delta)}`}
      role="img"
      aria-label="net worth trend"
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
      {end && <circle cx={end.x} cy={end.y} r={2.5} fill="currentColor" />}
    </svg>
  );
}
