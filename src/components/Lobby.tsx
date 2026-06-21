import Link from "next/link";
import { Bar } from "@/components/terminal/Bar";
import { Prompt } from "@/components/terminal/Prompt";
import { CommandK } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import { getBriefing } from "@/lib/connectors/briefing";
import { getHandOfTheDay } from "@/lib/connectors/riichi";
import { getLanguageStats } from "@/lib/connectors/translator";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { sampleBriefing } from "@/lib/sampleBriefing";
import { me, nav, now, reading as mockReading, riichi } from "@/lib/mock";

/** The public face of the hub — what visitors / recruiters see (ADR 0004). */
export async function Lobby() {
  const [reads, hand, briefingData, lang] = await Promise.all([
    getCurrentlyReading(),
    getHandOfTheDay(),
    getBriefing(),
    getLanguageStats(),
  ]);
  const briefing = briefingData ?? sampleBriefing;
  const top = reads[0];
  const handTeaser = hand
    ? hand.bestShanten === 0
      ? `tenpai · ${hand.ukeire} ukeire`
      : `${hand.bestShanten}-shanten · ${hand.ukeire} ukeire`
    : `hand #${riichi.handNo}`;
  const reading = top
    ? {
        title: top.title,
        chapter: top.chapter,
        total: top.total ?? 0,
        count: reads.length,
      }
    : {
        title: mockReading.title,
        chapter: mockReading.chapter,
        total: mockReading.total,
        count: 1,
      };

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

        {/* prompt / hero */}
        <Prompt tagline={me.tagline} />

        {/* module grid */}
        <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
          <Module label="now" className="border-0">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-muted">jp streak</span>
                <span className="tabular-nums text-fg">{lang.streakDays}d</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted">build</span>
                <Bar value={now.build.value} max={now.build.max} width={6} />
              </div>
            </div>
          </Module>

          <Module label="reading" className="border-0">
            <div className="space-y-2">
              <p className="line-clamp-2 text-fg">{reading.title}</p>
              <p className="text-xs text-muted">
                ch. {reading.chapter}
                {reading.total ? `/${reading.total}` : ""}
                {reading.count > 1 ? ` · ${reading.count} in progress` : ""}
              </p>
              {reading.total ? (
                <Bar value={reading.chapter} max={reading.total} width={8} />
              ) : null}
            </div>
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
            <div className="space-y-1">
              <p className="text-fg">{handTeaser}</p>
              <p className="text-xs text-muted">
                <span lang="ja" className="font-[family-name:var(--font-jp)]">
                  本日の一手
                </span>
              </p>
            </div>
          </Module>
        </div>

        {/* briefing */}
        <Link
          href="/briefing"
          className="block border-t border-hairline px-4 py-4 transition-colors hover:bg-surface/30"
        >
          <div className="mb-2 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-muted">
            <span>briefing</span>
            <span className="h-px flex-1 bg-hairline" />
            <span className="tabular-nums">
              {briefing.weekday} {briefing.date}
            </span>
          </div>
          <Tape items={briefing.tape.slice(0, 8)} />
          <p className="mt-3 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg/90">driving: {briefing.driver}</span>
            <span className="shrink-0 text-xs text-amber">full briefing →</span>
          </p>
        </Link>

        {/* nav */}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
          <nav className="flex gap-4 text-sm">
            {nav.map((item) =>
              item.ready ? (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-muted transition-colors hover:text-amber"
                >
                  {item.label}/
                </Link>
              ) : (
                <span
                  key={item.href}
                  className="cursor-default text-muted/40"
                  title="coming soon"
                  aria-disabled="true"
                >
                  {item.label}/
                </span>
              ),
            )}
          </nav>
          <CommandK />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/50">
        warm terminal · reading is live
      </p>
    </main>
  );
}
