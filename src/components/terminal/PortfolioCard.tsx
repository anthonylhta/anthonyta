import { Bar } from "@/components/terminal/Bar";
import type { Portfolio } from "@/lib/portfolio";

const aud = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const tone = (n: number) =>
  n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted";
const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "·");

export function PortfolioCard({ p }: { p: Portfolio }) {
  const t = p.totals;
  return (
    <div className="border-b border-hairline px-4 py-4">
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted">
        <span>portfolio</span>
        <span className="tabular-nums">as of {p.asOf}</span>
      </div>

      {/* headline */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-2xl tabular-nums text-fg">{aud(t.value)}</span>
        <span className={`tabular-nums ${tone(t.dayGain)}`}>
          {arrow(t.dayGain)} {aud(Math.abs(t.dayGain))} today
        </span>
        <span className="text-xs text-muted">
          cost {aud(t.cost)} · P&amp;L{" "}
          <span className={tone(t.pnl)}>
            {t.pnl >= 0 ? "+" : "−"}
            {aud(Math.abs(t.pnl))} ({t.pnlPct >= 0 ? "+" : ""}
            {t.pnlPct.toFixed(1)}%)
          </span>
        </span>
      </div>

      {/* holdings */}
      <div className="space-y-1.5">
        {p.holdings.map((h) => (
          <div key={h.code} className="flex items-center gap-3 text-sm">
            <span className="w-9 shrink-0 text-fg">{h.code}</span>
            <span className="w-28 shrink-0">
              <Bar value={h.value} max={t.value} width={8} />
            </span>
            <span className="flex-1 text-right tabular-nums text-fg/90">
              {aud(h.value)}
            </span>
            <span
              className={`w-24 shrink-0 text-right tabular-nums ${tone(h.dayGain)}`}
            >
              {arrow(h.dayGain)}
              {aud(Math.abs(h.dayGain))}
            </span>
            <span
              className={`w-16 shrink-0 text-right tabular-nums ${tone(h.pnl)}`}
            >
              {h.pnlPct >= 0 ? "+" : ""}
              {h.pnlPct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
