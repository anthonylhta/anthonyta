/** Pure display helpers — unit-tested in `format.test.ts`. */

/** Whole-percent of value/max, clamped at 0 when max is non-positive. */
export function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((value / max) * 100);
}

/**
 * Blocky ASCII progress bar (▓ filled / ░ empty) of the given character width.
 * Single source of truth for the bar string so the component and any text use
 * render identically.
 */
export function progressBar(value: number, max: number, width = 10): string {
  const filled = max <= 0 ? 0 : Math.round((value / max) * width);
  const f = Math.max(0, Math.min(width, filled));
  return "▓".repeat(f) + "░".repeat(width - f);
}
