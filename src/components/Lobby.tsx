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

/** Nav links the lobby leads with, rendered brighter than the rest. */
const PRIMARY_NAV = new Set<string>(["projects", "contact"]);

function NavItem({
  item,
  primary = false,
}: {
  item: (typeof nav)[number];
  primary?: boolean;
}) {
  if (!item.ready) {
    return (
      <span
        className="cursor-default text-muted/40"
        title="coming soon"
        aria-disabled="true"
      >
        {item.label}/
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      className={`transition-colors hover:text-amber ${primary ? "text-fg/90" : "text-muted"}`}
    >
      {item.label}/
    </Link>
  );
}

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

  // Lead the lobby nav with what the recruiter audience came for (ADR 0004);
  // the rest stay muted to keep the prompt the loudest thing on the page.
  const leadNav = nav.filter((item) => PRIMARY_NAV.has(item.label));
  const restNav = nav.filter((item) => !PRIMARY_NAV.has(item.label));

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

        {/* prompt / hero */}
        <Prompt tagline={me.tagline} subtitle={me.intro} />

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
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {leadNav.map((item) => (
              <NavItem key={item.href} item={item} primary />
            ))}
            {leadNav.length > 0 && restNav.length > 0 ? (
              <span aria-hidden className="text-muted/30">
                ·
              </span>
            ) : null}
            {restNav.map((item) => (
              <NavItem key={item.href} item={item} />
            ))}
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
