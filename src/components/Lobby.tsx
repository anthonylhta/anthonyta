import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { Bar } from "@/components/terminal/Bar";
import { Prompt } from "@/components/terminal/Prompt";
import { CommandK } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import {
  HAND_OF_THE_DAY_URL,
  MiniHand,
} from "@/components/terminal/PuzzleCard";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import { GithubModule } from "@/components/GithubModule";
import { LobbyFrame } from "@/components/LobbyFrame";
import { NowCard } from "@/components/NowCard";
import { TftModule } from "@/components/TftModule";
import { getBriefing } from "@/lib/connectors/briefing";
import { getGithub } from "@/lib/connectors/github";
import { getLayout } from "@/lib/connectors/layout";
import { getNow } from "@/lib/connectors/now";
import { getHandOfTheDay } from "@/lib/connectors/riichi";
import { getTft, getTftHistory } from "@/lib/connectors/tft";
import { getLanguageStats } from "@/lib/connectors/translator";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { relativeTime } from "@/lib/github";
import { hiddenSet, orderedUnits } from "@/lib/layout";
import { sampleBriefing } from "@/lib/sampleBriefing";
import { me, nav, reading as mockReading, riichi } from "@/lib/mock";

/** Nav links the lobby leads with, rendered brighter than the rest. */
const PRIMARY_NAV = new Set<string>(["projects", "resume", "contact"]);

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
  const [reads, hand, briefingData, lang, gh, tft, tftHistory, layout, now] =
    await Promise.all([
      getCurrentlyReading(),
      getHandOfTheDay(),
      getBriefing(),
      getLanguageStats(),
      getGithub(),
      getTft(),
      getTftHistory(),
      getLayout(),
      getNow(),
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

  // Each orderable lobby unit → its node (or null when hidden), keyed by unit
  // key; `orderedUnits` picks the sequence, and the default (empty) config
  // reproduces the hand-tuned order below (roadmap 59).
  const lobbyNodes: Record<string, ReactNode> = {
    top: ["languages", "reading", "riichi"].some((k) => !hidden.has(k)) ? (
      <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
        {!hidden.has("languages") && (
          <Module
            label="languages"
            className="border-0"
            action={
              <Link
                href="/ishin"
                className="text-xs text-amber hover:underline"
              >
                [open]
              </Link>
            }
          >
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-muted">jp streak</span>
                <span className="tabular-nums text-fg">{lang.streakDays}d</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-muted">translations</span>
                <span className="tabular-nums text-fg">{lang.total}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-muted">this week</span>
                <span className="tabular-nums text-fg">{lang.thisWeek}</span>
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
          <Module
            label="reading"
            className="border-0"
            action={
              <a
                href="https://novel.anthonyta.dev/user/mando"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber hover:underline"
              >
                [profile ↗]
              </a>
            }
          >
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
        )}

        {!hidden.has("riichi") && (
          <Module
            label="riichi"
            className="border-0"
            action={
              <a
                href={HAND_OF_THE_DAY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber hover:underline"
              >
                [solve ↗]
              </a>
            }
          >
            <div className="space-y-2">
              <p className="text-fg">{handTeaser}</p>
              {hand ? (
                <MiniHand puzzle={hand} />
              ) : (
                <p className="text-xs text-muted">
                  <span lang="ja" className="font-[family-name:var(--font-jp)]">
                    本日の一手
                  </span>
                </p>
              )}
            </div>
          </Module>
        )}
      </div>
    ) : null,
    github: !hidden.has("github") ? <GithubModule gh={gh} /> : null,
    tft: !hidden.has("tft") ? (
      <TftModule tft={tft} history={tftHistory} />
    ) : null,
    briefing: !hidden.has("briefing") ? (
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
    ) : null,
  };

  const units = orderedUnits(layout, "lobby");

  // The fold's label names what is actually behind it — each visible module by
  // its own name, which is its registry label before the parenthetical. Derived
  // rather than written out, so hiding a module in /system takes it off the row
  // too instead of promising something the slice no longer holds.
  const sliceNames = units.flatMap((u) =>
    u.modules
      .filter((m) => !hidden.has(m.key))
      .map((m) => m.label.replace(/\s*\(.*$/, "")),
  );
  const sliceLabel = sliceNames.length
    ? `the live slice — ${sliceNames.join(" · ")}`
    : null;

  // The pulse — three live facts under the card. Each is DROPPED when its
  // connector fell back to sample data: a front door that states a figure has to
  // mean it, and a placeholder streak beside "open to work" is a lie told to the
  // one audience that matters.
  const pushed = gh.isLive && gh.recent ? relativeTime(gh.recent.at) : null;
  const facts: ReactNode[] = [];
  if (pushed)
    facts.push(
      <span key="pushed">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-up align-middle" />{" "}
        pushed {pushed}
      </span>,
    );
  if (gh.isLive && gh.currentStreak > 0)
    facts.push(<span key="streak">{gh.currentStreak}d streak</span>);
  if (top) facts.push(<span key="reading">reading ch. {top.chapter}</span>);
  const pulse = facts.flatMap((fact, i) =>
    i === 0
      ? [fact]
      : [
          <span key={`sep-${i}`} aria-hidden className="text-muted/40">
            ·
          </span>,
          fact,
        ],
  );

  return (
    <LobbyFrame
      card={
        <>
          <StatusBar user="guest" />

          {/* prompt / hero — the name is the cursor line now, the trades and the
              availability signal the quiet one under it. */}
          <Prompt tagline={me.name} subtitle={`${me.tagline} — ${me.intro}`} />

          <NowCard now={now} />
        </>
      }
      pulse={pulse}
      sliceLabel={sliceLabel}
      slice={
        // modules render in the owner's layout order (roadmap 59); the default
        // order reproduces the hand-tuned lobby exactly.
        units.map((u) => (
          <Fragment key={u.key}>{lobbyNodes[u.key]}</Fragment>
        ))
      }
      nav={
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
      }
    />
  );
}
