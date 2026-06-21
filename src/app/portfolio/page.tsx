import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { PortfolioCard } from "@/components/terminal/PortfolioCard";
import { StatusBar } from "@/components/terminal/StatusBar";
import { getCash } from "@/lib/cash";
import { getPortfolio } from "@/lib/connectors/portfolio";
import { aud } from "@/lib/money";
import { samplePortfolio } from "@/lib/sampleDashboard";

export const metadata = { title: "portfolio" };

// Private finance — owner-only, read on demand.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  // Owner-only: guests get a 404, and the portfolio is only read after the gate.
  const session = await auth();
  if (!session?.user) notFound();

  const portfolio = (await getPortfolio()) ?? samplePortfolio;
  const cash = getCash();
  const netWorth = portfolio.totals.value + cash.cash + cash.hisa;
  const who = session.user.name ?? "anthony";

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
