import type { ReactNode } from "react";
import Link from "next/link";
import { SignOut } from "@/components/auth-buttons";
import { JournalActivityRow } from "@/components/JournalActivityRow";
import { NetWorthGlance } from "@/components/NetWorthGlance";
import { PasskeyManager } from "@/components/PasskeyManager";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { CommandK } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import { Sparkline } from "@/components/terminal/Sparkline";
import { VaultTodayGlance } from "@/components/VaultTodayGlance";
import { ACTIVITY_DAYS, dailyDeltas, toLevels } from "@/lib/activity";
import {
  b64ToBytes,
  hllEstimate,
  topPaths,
  type DayStats,
} from "@/lib/analytics";
import { mergeDays, readDays } from "@/lib/anastore";
import { getBriefing } from "@/lib/connectors/briefing";
import { getGithub } from "@/lib/connectors/github";
import { getRiichiStats } from "@/lib/connectors/riichi";
import { getLanguageStats } from "@/lib/connectors/translator";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import {
  indexBaseline,
  isSnapIndex,
  sydneyDaysAgo,
  type SnapIndexDay,
} from "@/lib/fin";
import { getSnapIndex } from "@/lib/finstore";
import { sampleBriefing, type TapeItem } from "@/lib/sampleBriefing";
import { r2Enabled } from "@/lib/r2";

/** Today's date in Sydney as YYYY-MM-DD (matches the vault's daily-note titles). */
function sydneyISODate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/** A "Sun 28 Jun" label for the TODAY zone header. */
function todayLabel(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
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
  const today = sydneyISODate();
  const [briefing, lang, reading, gh, indexRead, riichi, anaDays] =
    await Promise.all([
      getBriefing(),
      getLanguageStats(),
      getCurrentlyReading(),
      getGithub(),
      getSnapIndex(),
      getRiichiStats(),
      // The one place traffic numbers surface — read-only, owner-side (this
      // component never renders for a guest). Store off / no data → empty state.
      readDays(today, 7),
    ]);
  const b = briefing ?? sampleBriefing;

  // Reading week-over-week + trend now ride the sealed reading index (the cron's
  // plaintext day series), not the retired snapshot store. A store miss or a bad
  // shape → no days → the row's own "tracking…" fallback.
  let indexDays: SnapIndexDay[] = [];
  if (indexRead.state === "ok") {
    try {
      const parsed: unknown = JSON.parse(indexRead.value);
      if (isSnapIndex(parsed)) indexDays = parsed.days;
    } catch {
      // malformed index → leave days empty
    }
  }
  const readingBaseline = indexBaseline(indexDays, sydneyDaysAgo(7));
  const readingChapters = reading.reduce((sum, r) => sum + r.chapter, 0);
  const readingDelta =
    readingBaseline && reading.length > 0
      ? readingChapters - readingBaseline.readingChapters
      : null;

  const curated = ["ASX 200", "S&P 500", "BTC"]
    .map((label) => b.tape.find((tk) => tk.label === label))
    .filter((tk): tk is TapeItem => Boolean(tk));
  const ticks = curated.length ? curated : b.tape.slice(0, 3);

  // THIS WEEK rows — number = this week, strip = the trailing ~10-week trend.
  // riichi reads `puzzle_results` (the same table its app's streak uses), so its
  // solve history + real streak are live now (ADR 0046, was deferred under 0007/0044).
  const readingSeries = indexDays.map((d) => ({
    date: d.date,
    value: d.readingChapters,
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

        <PasskeyManager />

        {/* ───────────── TODAY ───────────── */}
        <Zone label="today" right={todayLabel()} />

        {/* net worth — a glance; full holdings + cash live on /portfolio. The
            numbers are a client island: everything rides the E2EE fin envelope
            (ADR 0061) and decrypts in the browser — sealed dots until unlocked. */}
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
          <NetWorthGlance offline={!r2Enabled()} />
        </div>

        {/* today's daily note, parsed: headline + planner + a journal peek. A
            client island — the note is sealed in the E2EE vault, so it's fetched +
            decrypted in the browser (unlock in files/), never server-rendered. */}
        <VaultTodayGlance offline={!r2Enabled()} date={today} />

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
            label="today's hand"
            className="border-0 sm:col-span-2"
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
          {rows.map((r) => (
            <ActivityRow
              key={r.k}
              k={r.k}
              value={r.value}
              levels={r.levels}
              last={false}
            />
          ))}
          {/* journal — a client island (the count + trend come from the sealed
              vault index), always the final, borderless row. */}
          <JournalActivityRow offline={!r2Enabled()} today={today} />
        </div>

        {/* ──────────── TRAFFIC ──────────── */}
        <Zone label="traffic" right="last 7 days" />
        <div className="px-4 py-3">
          <AnalyticsPanel today={today} days={anaDays} />
        </div>

        {/* quick jumps */}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-sm">
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
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
            <Link
              href="/files"
              className="text-amber/80 transition-colors hover:text-amber"
            >
              files/
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

/** Unique-visitor estimate for one (possibly empty) record. Empty sketch → 0. */
function uniquesOf(day: DayStats): number {
  return day.visitors_hll_b64
    ? hllEstimate(b64ToBytes(day.visitors_hll_b64))
    : 0;
}

/** Total pageviews across a record's paths. */
function viewsOf(day: DayStats): number {
  return Object.values(day.paths).reduce((sum, s) => sum + s.views, 0);
}

/**
 * The private traffic panel — cookieless pageviews + HLL unique estimates for today
 * and the trailing week, the top paths, and a uniques sparkline. Owner-only (it lives
 * inside the never-guest-rendered command center) and read-only. Store off / no data
 * → a quiet "no traffic yet". This is the ONLY place the numbers surface.
 */
function AnalyticsPanel({ today, days }: { today: string; days: DayStats[] }) {
  if (days.length === 0) {
    return <p className="text-muted">no traffic yet</p>;
  }

  const todayRec = days.find((d) => d.date === today);
  const todayViews = todayRec ? viewsOf(todayRec) : 0;
  const todayUniques = todayRec ? uniquesOf(todayRec) : 0;

  // Week totals ride the merged sketch — register-max unions the daily uniques so a
  // returning visitor isn't double-counted across days.
  const weekAgg = mergeDays(days);
  const weekViews = viewsOf(weekAgg);
  const weekUniques = uniquesOf(weekAgg);
  const top = topPaths(weekAgg).slice(0, 5);

  const spark = days.map(uniquesOf);
  const delta = spark.length >= 2 ? spark[spark.length - 1] - spark[0] : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px bg-hairline">
        <Stat label="today" views={todayViews} uniques={todayUniques} />
        <Stat label="this week" views={weekViews} uniques={weekUniques} />
      </div>

      {spark.length >= 2 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted">
            daily uniques
          </div>
          <Sparkline values={spark} delta={delta} height={40} />
        </div>
      )}

      {top.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted">
            top paths
          </div>
          <ul className="space-y-0.5">
            {top.map((p) => (
              <li
                key={p.path}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="truncate font-[family-name:var(--font-geist-mono)] text-fg/90">
                  {p.path}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  <span className="text-amber">{p.views}</span> · {p.uniques}{" "}
                  uniq
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One traffic stat cell — views over unique estimate, mono + lowercase. */
function Stat({
  label,
  views,
  uniques,
}: {
  label: string;
  views: number;
  uniques: number;
}) {
  return (
    <div className="bg-surface/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 tabular-nums">
        <span className="text-lg text-amber">{views}</span>{" "}
        <span className="text-xs text-muted">views</span>
      </div>
      <div className="text-xs tabular-nums text-muted">
        {uniques} unique{uniques === 1 ? "" : "s"}
      </div>
    </div>
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
