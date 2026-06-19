import type { TapeItem } from "@/lib/sampleBriefing";

/** A row of market levels with green/red moves — the briefing "tape". */
export function Tape({
  items,
  className = "",
}: {
  items: TapeItem[];
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs ${className}`}>
      {items.map((it) => (
        <span key={it.label} className="whitespace-nowrap tabular-nums">
          <span className="text-muted">{it.label}</span>{" "}
          <span className="text-fg">{it.value}</span>
          {it.move != null && (
            <span className={`ml-1 ${it.move >= 0 ? "text-up" : "text-down"}`}>
              {it.move >= 0 ? "▲" : "▼"}
              {Math.abs(it.move).toFixed(1)}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
