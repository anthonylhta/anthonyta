import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { JobsLog } from "@/components/JobsLog";
import { StatusBar } from "@/components/terminal/StatusBar";
import { r2Enabled } from "@/lib/r2";

export const metadata = { title: "jobs" };

// The application ledger — owner-only, and every row decrypts in the browser.
export const dynamic = "force-dynamic";

/** Today's date in Sydney as YYYY-MM-DD — anchored once on the server so ages
 *  and the composer's default date can't sit on different days. */
function sydneyISODate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

export default async function JobsPage() {
  // Owner-only: guests get a 404 (ADR 0022). The whole ledger lives inside the
  // E2EE jobs envelope and decrypts in the client island — the server renders
  // only the shell, so there is nothing here to read past the gate.
  const session = await auth();
  if (!session?.user) notFound();

  const who = session.user.name ?? "anthony";

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">jobs</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        <JobsLog offline={!r2Enabled()} today={sydneyISODate()} />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
