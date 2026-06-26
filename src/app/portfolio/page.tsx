import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { PortfolioCard } from "@/components/terminal/PortfolioCard";
import { Sparkline } from "@/components/terminal/Sparkline";
import { StatusBar } from "@/components/terminal/StatusBar";
import { getCash } from "@/lib/cash";
import { getPortfolio } from "@/lib/connectors/portfolio";
import { arrow, aud, tone } from "@/lib/money";
import { getSeries } from "@/lib/snapshots";
import { samplePortfolio } from "@/lib/sampleDashboard";

export const metadata = { title: "portfolio" };

// Private finance — owner-only, read on demand.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  // Owner-only: guests get a 404, and the portfolio is only read after the gate.
  const session = await auth();
  if (!session?.user) notFound();

  const [portfolioData, series] = await Promise.all([
    getPortfolio(),
    getSeries(30),
  ]);
  const portfolio = portfolioData ?? samplePortfolio;
  const cash = getCash();
  const netWorth = portfolio.totals.value + cash.cash + cash.hisa;
  const who = session.user.name ?? "anthony";

  // The daily net-worth series (snapshots already include cash, ADR 0033). Needs at
  // least two points to draw a line; before that the chart yields to a quiet note.
  const nw = series.map((p) => p.netWorthCents / 100);
  const trend =
    nw.length >= 2
      ? {
          values: nw,
          delta: nw[nw.length - 1] - nw[0],
          from: series[0].date.slice(5),
          to: series[series.length - 1].date.slice(5),
        }
      : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            portfolio
          </span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        {/* net worth — invested + cash */}
        <div className="border-b border-hairline px-4 py-4">
          <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">
            net worth
          </p>
          <span className="text-2xl tabular-nums text-fg">{aud(netWorth)}</span>
          <span className="ml-3 text-xs tabular-nums text-muted">
            invested {aud(portfolio.totals.value)} · cash{" "}
            {aud(cash.cash + cash.hisa)}
          </span>

          {trend ? (
            <div className="mt-4">
              <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-muted">
                <span>trend</span>
                <span className={`tabular-nums ${tone(trend.delta)}`}>
                  {arrow(trend.delta)} {trend.delta >= 0 ? "+" : ""}
                  {aud(trend.delta)}
                </span>
              </div>
              <Sparkline values={trend.values} delta={trend.delta} />
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted/60">
                <span>{trend.from}</span>
                <span>{trend.to}</span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-muted/60">
              trend builds as daily snapshots accrue
            </p>
          )}
        </div>

        {/* invested — the holdings */}
        <PortfolioCard p={portfolio} />

        {/* cash + HISA */}
        <div className="border-t border-hairline px-4 py-4">
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
            cash
          </p>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted">chequing</span>
              <span className="tabular-nums text-fg/90">{aud(cash.cash)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted">
                HISA{cash.rate ? ` · ${cash.rate}% p.a.` : ""}
              </span>
              <span className="tabular-nums text-fg/90">{aud(cash.hisa)}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
