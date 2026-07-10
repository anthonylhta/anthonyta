import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { PortfolioCard } from "@/components/terminal/PortfolioCard";
import { StatusBar } from "@/components/terminal/StatusBar";
import { getPortfolio } from "@/lib/connectors/portfolio";
import { blobEnabled } from "@/lib/finstore";
import { samplePortfolio } from "@/lib/sampleDashboard";
import { FinPanel } from "./FinPanel";

export const metadata = { title: "portfolio" };

// Private finance — owner-only, read on demand.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  // Owner-only: guests get a 404, and the portfolio is only read after the gate.
  const session = await auth();
  if (!session?.user) notFound();

  const portfolioData = await getPortfolio();
  const portfolio = portfolioData ?? samplePortfolio;
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

        {/* Cash + net-worth trend are sealed under the vault key and decrypt in the
            client island; the holdings stay server-rendered, passed through as a
            prop so the order (net worth → holdings → cash) is preserved. */}
        <FinPanel
          invested={portfolio.totals.value}
          offline={!blobEnabled()}
          holdings={<PortfolioCard p={portfolio} />}
        />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
