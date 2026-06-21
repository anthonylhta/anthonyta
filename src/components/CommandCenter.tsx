import Link from "next/link";
import { SignOut } from "@/components/auth-buttons";
import { CommandK } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import { getCash } from "@/lib/cash";
import { getBriefing } from "@/lib/connectors/briefing";
import { getPortfolio } from "@/lib/connectors/portfolio";
import { getLanguageStats } from "@/lib/connectors/translator";
import { arrow, aud, tone } from "@/lib/money";
import { sampleBriefing, type TapeItem } from "@/lib/sampleBriefing";
import { sampleDashboard as d, samplePortfolio } from "@/lib/sampleDashboard";

/** The day's date, in Sydney — the command center runs on local time. */
function sydneyDate(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
}

/** Your private daily driver — what `/` becomes when you're logged in (ADR 0004). */
export async function CommandCenter({ userName }: { userName: string }) {
  const [portfolioData, briefing, lang] = await Promise.all([
    getPortfolio(),
    getBriefing(),
    getLanguageStats(),
  ]);
  const portfolio = portfolioData ?? samplePortfolio;
  const b = briefing ?? sampleBriefing;
  const cash = getCash();
  const t = portfolio.totals;
  const netWorth = t.value + cash.cash + cash.hisa;

  // A 3-tick market pulse for the glance module — the personalized take lives on
  // /briefing now, not dumped on the front. Curate the headline levels, fall back
  // to the first three (the connector orders them most-important-first).
  const curated = ["ASX 200", "S&P 500", "BTC"]
    .map((label) => b.tape.find((t) => t.label === label))
    .filter((t): t is TapeItem => Boolean(t));
  const ticks = curated.length ? curated : b.tape.slice(0, 3);

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

        {/* net worth — a glance; the full holdings + cash live on /portfolio */}
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
            <span className={`tabular-nums ${tone(t.dayGain)}`}>
              {arrow(t.dayGain)} {aud(Math.abs(t.dayGain))} today
            </span>
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            invested {aud(t.value)}
            {cash.cash > 0 ? ` · cash ${aud(cash.cash)}` : ""}
            {cash.hisa > 0
              ? ` · HISA ${aud(cash.hisa)}${cash.rate ? ` @ ${cash.rate}%` : ""}`
              : ""}
          </p>
        </div>

        {/* the rest of your life — a grid of glances, briefing among them */}
        <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2">
          {/* markets briefing — a pulse, not a wall of text; the full take is one
              click away on /briefing (the portfolio-relevance note lives there). */}
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

          <Module label="reading" className="border-0">
            <p className="line-clamp-1 text-fg">{d.reading.title}</p>
            <p className="text-xs text-muted">
              ch {d.reading.chapter}/{d.reading.total} · {d.reading.streakDays}
              -day streak
            </p>
          </Module>

          <Module
            label="riichi"
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
              streak {d.riichi.currentStreak}{" "}
              <span className="text-muted">· best {d.riichi.bestStreak}</span>
            </p>
            <p className="text-xs text-muted">
              <span lang="ja" className="font-[family-name:var(--font-jp)]">
                本日の一手
              </span>{" "}
              — {d.riichi.todaySolved ? "solved ✓" : "unsolved"}
            </p>
          </Module>

          <Module
            label="languages"
            className="border-0"
            action={
              <Link
                href="/translator"
                className="text-xs text-amber hover:underline"
              >
                [open]
              </Link>
            }
          >
            <p className="text-fg">
              {lang.total} translations{" "}
              <span className="text-muted">· {lang.streakDays}d streak</span>
            </p>
            <p className="text-xs text-muted">
              this week {lang.thisWeek}
              {lang.topTone ? ` · mostly ${lang.topTone}` : ""}
            </p>
          </Module>

          <Module
            label="today"
            className="border-0"
            action={
              <span className="text-xs tabular-nums text-muted">
                {sydneyDate()}
              </span>
            }
          >
            <p className="text-fg">
              <span className="text-amber">→</span> {d.today.focus}
            </p>
            <ul className="mt-1.5 space-y-1 text-xs">
              {d.today.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-muted">☐</span>
                  <span className="text-fg/90">{item}</span>
                </li>
              ))}
            </ul>
          </Module>
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
