/**
 * Pure geometry for the hand-rolled sparkline (no chart library — keeps deps lean
 * and the look ours). Maps a series of values into SVG coordinates within a
 * `width`×`height` box: a polyline for the line and a closed path for the area
 * fill. Higher value → smaller y (SVG's origin is top-left), so the line rises with
 * the number. A flat series (all equal) draws a centered horizontal line.
 */
export interface SparkGeom {
  /** `"x,y x,y …"` for a <polyline points>. */
  line: string;
  /** `"M … L … Z"` closing down to the baseline, for an area <path d>. */
  area: string;
  /** The plotted points, for placing an end-cap dot. */
  points: { x: number; y: number }[];
}

const r = (n: number) => Math.round(n * 100) / 100;

export function sparkGeometry(
  values: number[],
  width: number,
  height: number,
  pad = 2,
): SparkGeom {
  const n = values.length;
  if (n === 0) return { line: "", area: "", points: [] };

  const innerH = height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const points = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y =
      span === 0 ? height / 2 : pad + innerH - ((v - min) / span) * innerH;
    return { x: r(x), y: r(y) };
  });

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const first = points[0];
  const last = points[n - 1];
  const area =
    `M ${first.x},${first.y} ` +
    points
      .slice(1)
      .map((p) => `L ${p.x},${p.y}`)
      .join(" ") +
    ` L ${last.x},${r(height)} L ${first.x},${r(height)} Z`;

  return { line, area, points };
}
