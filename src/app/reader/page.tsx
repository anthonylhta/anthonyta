import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { ReaderList } from "@/components/ReaderList";
import { StatusBar } from "@/components/terminal/StatusBar";
import { getReaderItems } from "@/lib/connectors/reader";
import { r2Enabled } from "@/lib/r2";
import { FEEDS } from "@/lib/reader";

export const metadata = { title: "reader" };

// Owner-only morning feeds — read on demand, cached at the data layer.
export const dynamic = "force-dynamic";

/** Render-time clock for the age column (the todayLabel() idiom — the page is
 *  force-dynamic, so every request re-renders with a fresh read). */
function renderNow(): number {
  return Date.now();
}

export default async function ReaderPage() {
  // Owner-only: the feed list profiles the owner, and republishing other
  // people's headlines on a public page is a can of worms (ADR 0022 wall).
  const session = await auth();
  if (!session?.user) notFound();

  const who = session.user.name ?? "anthony";
  const { sample, items } = await getReaderItems();
  const now = renderNow();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">reader</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-2 text-xs text-muted">
          <span>{FEEDS.map((f) => f.label).join(" · ")}</span>
          {sample && (
            <span className="border border-hairline px-1.5 py-0.5 text-[10px]">
              sample — feeds unreachable
            </span>
          )}
          <span className="ml-auto">refreshes every 30 min</span>
        </div>

        <ReaderList items={items} now={now} offline={!r2Enabled()} />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
