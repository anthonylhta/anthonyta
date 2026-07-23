import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { AuthJournalPanel } from "@/components/AuthJournal";
import { LayoutPanel } from "@/components/LayoutPanel";
import { PasskeyManager } from "@/components/PasskeyManager";
import { RecoveryShares } from "@/components/RecoveryShares";
import { RotationPanel } from "@/components/RotationPanel";
import {
  AnalyticsPanel,
  CspPanel,
  LastSignIn,
} from "@/components/SystemPanels";
import { StatusBar } from "@/components/terminal/StatusBar";
import { readDays } from "@/lib/anastore";
import { getAuthLog } from "@/lib/authlogstore";
import { sydneyToday } from "@/lib/fin";
import { r2Enabled } from "@/lib/r2";

export const metadata = { title: "system" };

// Strictly private: reads the session and the stores on demand.
export const dynamic = "force-dynamic";

export default async function SystemPage() {
  // Owner-only. Guests get a 404 — the page never reveals it exists, and the
  // stores are only read after this gate, so nothing reaches a guest.
  const session = await auth();
  if (!session?.user) notFound();

  const who = session.user.name ?? "anthony";
  const today = sydneyToday();
  // Traffic reads its own week here (owner-side, after the gate) — this used to
  // ride the command center's Promise.all; it moved out with the panel.
  const anaDays = await readDays(today, 7);
  // The journal ships RAW to a client island: the chain's verdict must come
  // from the browser, not from the server that authored the record.
  const journal = await getAuthLog();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">system</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        {/* ───────────── ACCESS ───────────── */}
        <Section label="access" />
        <PasskeyManager />
        <LastSignIn />
        <RecoveryShares offline={!r2Enabled()} />

        {/* ───────────── LAYOUT ───────────── */}
        <Section label="layout" right="visibility" />
        <div className="px-4 py-3">
          <LayoutPanel offline={!r2Enabled()} />
        </div>

        {/* ───────────── JOURNAL ───────────── */}
        <Section label="journal" right="hash-chained" />
        <div className="px-4 py-3">
          <AuthJournalPanel
            raw={journal.state === "ok" ? journal.value : null}
            state={journal.state}
          />
        </div>

        {/* ───────────── TRAFFIC ───────────── */}
        <Section label="traffic" right="last 7 days" />
        <div className="px-4 py-3">
          <AnalyticsPanel today={today} days={anaDays} />
        </div>

        {/* ───────────── CSP ───────────── */}
        <Section label="csp" right="last 7 days" />
        <div className="px-4 py-3">
          <CspPanel today={today} />
        </div>

        {/* ───────────── ROTATION ───────────── */}
        <Section label="rotation" right="master key" />
        <div className="px-4 py-3">
          <RotationPanel offline={!r2Enabled()} />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}

/** A section divider — the Warm-Terminal zone shape reused for /system's three bands. */
function Section({ label, right }: { label: string; right?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline bg-amber/[0.04] px-4 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.22em] text-amber/85">
        ▍ {label}
      </span>
      {right && (
        <span className="text-[11px] tabular-nums text-muted">{right}</span>
      )}
    </div>
  );
}
