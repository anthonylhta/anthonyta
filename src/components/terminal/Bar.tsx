import { pct, progressBar } from "@/lib/format";

/** Blocky amber/hairline progress bar with a trailing percent. */
export function Bar({
  value,
  max,
  width = 10,
}: {
  value: number;
  max: number;
  width?: number;
}) {
  const bar = progressBar(value, max, width);
  const filledLen = bar.length - bar.replace(/▓/g, "").length;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-amber">{"▓".repeat(filledLen)}</span>
      <span className="text-hairline">{"░".repeat(width - filledLen)}</span>
      <span className="ml-2 text-muted">{pct(value, max)}%</span>
    </span>
  );
}
