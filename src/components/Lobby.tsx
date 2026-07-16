import Link from "next/link";
import { Bar } from "@/components/terminal/Bar";
import { Prompt } from "@/components/terminal/Prompt";
import { CommandK } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import { GithubModule } from "@/components/GithubModule";
import { TftModule } from "@/components/TftModule";
import { getBriefing } from "@/lib/connectors/briefing";
import { getGithub } from "@/lib/connectors/github";
import { getLayout } from "@/lib/connectors/layout";
import { getHandOfTheDay } from "@/lib/connectors/riichi";
import { getTft, getTftHistory } from "@/lib/connectors/tft";
import { getLanguageStats } from "@/lib/connectors/translator";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { hiddenSet } from "@/lib/layout";
import { sampleBriefing } from "@/lib/sampleBriefing";
import { me, nav, reading as mockReading, riichi } from "@/lib/mock";

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
  const [reads, hand, briefingData, lang, gh, tft, tftHistory, layout] =
    await Promise.all([
      getCurrentlyReading(),
      getHandOfTheDay(),
      getBriefing(),
      getLanguageStats(),
      getGithub(),
      getTft(),
      getTftHistory(),
      getLayout(),
    ]);
  const briefing = briefingData ?? sampleBriefing;
  // Owner-curated visibility (roadmap 59): a hidden module simply doesn't
  // render — guests see whatever the layout config currently says.
  const hidden = hiddenSet(layout, "lobby");
  const top = reads[0];
  const handTeaser = hand
    ? "what would you discard?"
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

  // Tone mix share of the most-used tone (aggregate only — ADR 0015/0016).
  const toneTotal = lang.tones.reduce((sum, t) => sum + t.count, 0);
  const topTonePct =
    lang.topTone && toneTotal > 0
      ? Math.round(((lang.tones[0]?.count ?? 0) / toneTotal) * 100)
      : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

        {/* prompt / hero */}
        <Prompt tagline={me.tagline} subtitle={me.intro} />

        {/* module grid */}
        {["languages", "reading", "riichi"].some((k) => !hidden.has(k)) && (
          <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
            {!hidden.has("languages") && (
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
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted">jp streak</span>
                    <span className="tabular-nums text-fg">
                      {lang.streakDays}d
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted">translations</span>
                    <span className="tabular-nums text-fg">{lang.total}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted">this week</span>
                    <span className="tabular-nums text-fg">
                      {lang.thisWeek}
                    </span>
                  </div>
                  {topTonePct != null ? (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-muted">tone</span>
                      <span className="text-fg">
                        <span className="text-amber">{lang.topTone}</span>{" "}
                        {topTonePct}%
                      </span>
                    </div>
                  ) : null}
                </div>
              </Module>
            )}

            {!hidden.has("reading") && (
              <Module label="reading" className="border-0">
                <div className="space-y-2">
                  <p className="line-clamp-2 text-fg">{reading.title}</p>
                  <p className="text-xs text-muted">
                    ch. {reading.chapter}
                    {reading.total ? `/${reading.total}` : ""}
                    {reading.count > 1 ? ` · ${reading.count} in progress` : ""}
                  </p>
                  {reading.total ? (
                    <Bar
                      value={reading.chapter}
                      max={reading.total}
                      width={8}
                    />
                  ) : null}
                </div>
              </Module>
            )}

            {!hidden.has("riichi") && (
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
                    <span
                      lang="ja"
                      className="font-[family-name:var(--font-jp)]"
                    >
                      本日の一手
                    </span>
                  </p>
                </div>
              </Module>
            )}
          </div>
        )}

        {/* code — github activity */}
        {!hidden.has("github") && <GithubModule gh={gh} />}

        {/* arena — tft ladder */}
        {!hidden.has("tft") && <TftModule tft={tft} history={tftHistory} />}

        {/* briefing */}
        {!hidden.has("briefing") && (
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
              <span className="shrink-0 text-xs text-amber">
                full briefing →
              </span>
            </p>
          </Link>
        )}

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
