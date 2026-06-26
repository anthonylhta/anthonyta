import type { ReactNode } from "react";
import Link from "next/link";
import { SignOut } from "@/components/auth-buttons";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { CommandK } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import {
  ACTIVITY_DAYS,
  dailyCounts,
  dailyDeltas,
  toLevels,
} from "@/lib/activity";
import { getCash } from "@/lib/cash";
import { getBriefing } from "@/lib/connectors/briefing";
import { getGithub } from "@/lib/connectors/github";
import { getPortfolio } from "@/lib/connectors/portfolio";
import { getRiichiStats } from "@/lib/connectors/riichi";
import { getLanguageStats } from "@/lib/connectors/translator";
import { getVaultIndex } from "@/lib/connectors/vault";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { arrow, aud, tone } from "@/lib/money";
import { getBaseline, getSeries } from "@/lib/snapshots";
import { sampleBriefing, type TapeItem } from "@/lib/sampleBriefing";
import { sampleDashboard as d, samplePortfolio } from "@/lib/sampleDashboard";

/** Today's date in Sydney as YYYY-MM-DD (matches the vault's daily-note titles). */
function sydneyISODate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/** How many vault notes were touched in the last 7 days. */
function journalThisWeek(notes: { modified: string }[]): number {
  const weekAgo = Date.now() - 7 * 86_400_000;
  return notes.filter((n) => Date.parse(n.modified) >= weekAgo).length;
}

/** A "15 Jun – 21 Jun" label for the trailing week. */
function weekRange(): string {
  const day = (dt: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Australia/Sydney",
      day: "numeric",
      month: "short",
    }).format(dt);
  const now = new Date();
  return `${day(new Date(now.getTime() - 6 * 86_400_000))} – ${day(now)}`;
}

/**
 * Your private daily driver — what `/` becomes when you're logged in (ADR 0004).
 * Two zones (ADR 0032): TODAY = what you act on now; THIS WEEK = the rolling digest.
 * Each domain lives in exactly one zone. THIS WEEK now pairs each domain's
 * this-week number with its trailing ~10-week trend strip (ADR 0044) — the digest
 * IS the pulse, so there's no separate heatmap to duplicate it.
 */
export async function CommandCenter({ userName }: { userName: string }) {
  const [
    portfolioData,
    briefing,
    lang,
    vault,
    reading,
    baseline,
    gh,
    snapshots,
    riichi,
  ] = await Promise.all([
    getPortfolio(),
    getBriefing(),
    getLanguageStats(),
    getVaultIndex(),
    getCurrentlyReading(),
    getBaseline(),
    getGithub(),
    getSeries(ACTIVITY_DAYS),
    getRiichiStats(),
  ]);
  const portfolio = portfolioData ?? samplePortfolio;
  const b = briefing ?? sampleBriefing;
  const cash = getCash();
  const t = portfolio.totals;
  const netWorth = t.value + cash.cash + cash.hisa;

  // Week-over-week deltas — diff today against a snapshot from ~7 days ago (ADR 0033).
  // null (no baseline yet, or the store is off) → "tracking…".
  const netWorthDelta = baseline
    ? netWorth - baseline.netWorthCents / 100
    : null;
  const readingChapters = reading.reduce((sum, r) => sum + r.chapter, 0);
  const readingDelta =
    baseline && reading.length > 0
      ? readingChapters - baseline.readingChapters
      : null;

  const curated = ["ASX 200", "S&P 500", "BTC"]
    .map((label) => b.tape.find((tk) => tk.label === label))
    .filter((tk): tk is TapeItem => Boolean(tk));
  const ticks = curated.length ? curated : b.tape.slice(0, 3);

  // vault-backed bits: today's "now" snippet + the week's journal count
  const today = sydneyISODate();
  const todayNote = vault.find((n) => n.title === today);
  const journalCount = journalThisWeek(vault);

  // THIS WEEK rows — number = this week, strip = the trailing ~10-week trend.
  // riichi reads `puzzle_results` (the same table its app's streak uses), so its
  // solve history + real streak are live now (ADR 0046, was deferred under 0007/0044).
  const readingSeries = snapshots.map((p) => ({
    date: p.date,
    value: p.readingChapters,
  }));
  const rows: { k: string; value: ReactNode; levels: number[] }[] = [
    {
      k: "commits",
      value: <span className="text-amber">+{gh.thisWeek}</span>,
      levels: toLevels(gh.daily.slice(-ACTIVITY_DAYS)),
    },
    {
      k: "reading",
      value:
        readingDelta !== null ? (
          <span>
            <span className="text-amber">
              {readingDelta >= 0 ? "+" : ""}
              {readingDelta}
            </span>{" "}
            ch
          </span>
        ) : (
          <span className="text-muted">tracking…</span>
        ),
      levels: toLevels(dailyDeltas(readingSeries, ACTIVITY_DAYS, today)),
    },
    {
      k: "languages",
      value: <span className="text-amber">+{lang.thisWeek}</span>,
      levels: toLevels(lang.activity),
    },
    {
      k: "riichi",
      value: (
        <span>
          streak <span className="text-amber">{riichi.currentStreak}</span>
        </span>
      ),
      levels: toLevels(riichi.activity),
    },
    {
      k: "journal",
      value: (
        <span>
          <span className="text-amber">{journalCount}</span> notes
        </span>
      ),
      levels: toLevels(
        dailyCounts(
          vault.map((n) => n.modified),
          ACTIVITY_DAYS,
          today,
        ),
      ),
    },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={userName} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <span className="uppercase tracking-[0.2em] text-muted">
            command center
          </span>
          <SignOut className="text-muted transition-colors hover:text-amber" />
        </div>

        {/* ───────────── TODAY ───────────── */}
        <Zone label="today" />

        {/* net worth — a glance; full holdings + cash live on /portfolio */}
        <div className="border-b border-hairline px-4 py-4">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted">
            <span>net worth</span>
            <Link
              href="/portfolio"
              className="normal-case tracking-normal text-amber hover:underline"
            >
              portfolio →
            </Link>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl tabular-nums text-fg">
              {aud(netWorth)}
            </span>
            {netWorthDelta !== null && (
              <span className={`text-sm tabular-nums ${tone(netWorthDelta)}`}>
                {arrow(netWorthDelta)} {netWorthDelta >= 0 ? "+" : ""}
                {aud(netWorthDelta)} this week
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            invested {aud(t.value)}
            {cash.cash > 0 ? ` · cash ${aud(cash.cash)}` : ""}
            {cash.hisa > 0
              ? ` · HISA ${aud(cash.hisa)}${cash.rate ? ` @ ${cash.rate}%` : ""}`
              : ""}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2">
          <Module
            label="briefing"
            className="border-0 sm:col-span-2"
            action={
              <Link
                href="/briefing"
                className="text-xs text-amber hover:underline"
              >
                [full]
              </Link>
            }
          >
            <p className="text-fg">{b.driver}</p>
            <Tape items={ticks} className="mt-2" />
          </Module>

          <Module
            label="now"
            className="border-0"
            action={
              <Link
                href="/vault"
                className="text-xs text-amber hover:underline"
              >
                vault →
              </Link>
            }
          >
            <p className="text-fg">
              <span className="text-amber">→</span> {d.today.focus}
            </p>
            {todayNote?.preview && (
              <p className="mt-1.5 line-clamp-2 text-xs text-muted">
                <span className="tabular-nums">{today}</span> ·{" "}
                {todayNote.preview}
              </p>
            )}
          </Module>

          <Module
            label="today's hand"
            className="border-0"
            action={
              <Link
                href="/riichi"
                className="text-xs text-amber hover:underline"
              >
                [solve]
              </Link>
            }
          >
            <p className="text-fg">
              <span lang="ja" className="font-[family-name:var(--font-jp)]">
                本日の一手
              </span>{" "}
              — {riichi.todaySolved ? "solved ✓" : "unsolved"}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              solve to keep the streak
            </p>
          </Module>
        </div>

        {/* ──────────── THIS WEEK ──────────── */}
        <Zone label="this week" right={weekRange()} />
        <div className="px-4 py-2">
          {rows.map((r, i) => (
            <ActivityRow
              key={r.k}
              k={r.k}
              value={r.value}
              levels={r.levels}
              last={i === rows.length - 1}
            />
          ))}
        </div>

        {/* quick jumps */}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-sm">
          <nav className="flex gap-4">
            <Link
              href="/briefing"
              className="text-muted transition-colors hover:text-amber"
            >
              briefing/
            </Link>
            <Link
              href="/riichi"
              className="text-muted transition-colors hover:text-amber"
            >
              riichi/
            </Link>
            <Link
              href="/translator"
              className="text-muted transition-colors hover:text-amber"
            >
              translator/
            </Link>
            <Link
              href="/vault"
              className="text-amber/80 transition-colors hover:text-amber"
            >
              vault/
            </Link>
          </nav>
          <CommandK />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        private command center · {userName}
      </p>
    </main>
  );
}

/** A zone divider — the dashboard's fixed shape (today vs this week). */
function Zone({ label, right }: { label: string; right?: string }) {
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

/** One THIS WEEK row — a fixed key column, the week's number, and the trend strip. */
function ActivityRow({
  k,
  value,
  levels,
  last,
}: {
  k: string;
  value: ReactNode;
  levels: number[];
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 py-2 text-sm ${last ? "" : "border-b border-hairline/40"}`}
    >
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
        {k}
      </span>
      <span className="w-24 shrink-0 tabular-nums text-fg/90">{value}</span>
      <span className="min-w-0 flex-1">
        <ActivityStrip levels={levels} />
      </span>
    </div>
  );
}
