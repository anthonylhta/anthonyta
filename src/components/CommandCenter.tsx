import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ApertureMasthead } from "@/components/ApertureMasthead";
import { SignOut } from "@/components/auth-buttons";
import { ChoresRow } from "@/components/ChoresRow";
import { DropInbox } from "@/components/DropInbox";
import { GuideSealed, type GuideEvidence } from "@/components/GuideSealed";
import { JournalPulse } from "@/components/JournalPulse";
import { CommandK } from "@/components/terminal/CommandPalette";
import { StatusBar } from "@/components/terminal/StatusBar";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { TodoGlance } from "@/components/TodoGlance";
import { TransitGlance } from "@/components/TransitGlance";
import { VaultTodayGlance } from "@/components/VaultTodayGlance";
import { ACTIVITY_DAYS, toLevels } from "@/lib/activity";
import { CHORE_CADENCE_DAYS, choreState } from "@/lib/chores";
import { getApertureGlance } from "@/lib/connectors/aperture";
import { getBriefing } from "@/lib/connectors/briefing";
import { getChoreReads } from "@/lib/connectors/chores";
import { getGithub } from "@/lib/connectors/github";
import { getHealth } from "@/lib/connectors/health";
import { getLayout } from "@/lib/connectors/layout";
import { getRiichiStats } from "@/lib/connectors/riichi";
import { getSteps } from "@/lib/connectors/steps";
import { getTft } from "@/lib/connectors/tft";
import { getLanguageStats } from "@/lib/connectors/translator";
import { getWeather } from "@/lib/connectors/weather";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { listDrops } from "@/lib/dropstore";
import {
  indexBaseline,
  isSnapIndex,
  sydneyDaysAgo,
  type SnapIndexDay,
} from "@/lib/fin";
import { mortalSegments } from "@/lib/apertureview";
import {
  hiddenSet,
  orderedUnitsInZone,
  type Zone as CenterZone,
} from "@/lib/layout";
import { stepsForDay, trailingSeries } from "@/lib/steps";
import { uvLabel, weatherCodeText } from "@/lib/weather";
import { getSnapIndex } from "@/lib/finstore";
import { sampleBriefing } from "@/lib/sampleBriefing";
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

/**
 * How many sealed drop-box messages are waiting. METADATA ONLY — the count of
 * objects under the prefix, the same thing the owner-gated list route exposes;
 * no envelope is ever read here. Any miss (store off, a failed list) reads as
 * zero, which simply means the row doesn't render.
 */
async function dropCount(): Promise<number> {
  try {
    const { objects } = await listDrops();
    return objects.length;
  } catch {
    return 0;
  }
}

/** The zones this page renders on the SERVER, top to bottom, with the divider each
 *  one gets. Only TODAY is here: the sheet's three status bands all live in one
 *  sealed envelope, so they are drawn by the client island below — which consumes
 *  the very same registry through its `sections` prop, so hiding or reordering a
 *  band in /system still works exactly as it does for a row down here. */
const ZONES: { zone: CenterZone; label?: string; right?: () => string }[] = [
  { zone: "today", label: "today", right: todayLabel },
];

/** The sheet's sealed bands, in render order — the zones whose units the island
 *  draws rather than the server loop. */
const SEALED_ZONES: CenterZone[] = ["wall", "paths", "trials"];

/**
 * Your private daily driver — what `/` becomes when you're logged in (ADR 0004).
 * The page IS the character sheet: the rank masthead, then the wall being worked,
 * the conditions holding it open, the paths and their evidence, the trials — then
 * TODAY, the day's rows plus the exception rows that only speak when something is
 * due or down.
 *
 * The hierarchy is inverted from the old dashboard on purpose. Nothing on this page
 * is a "module" reporting a number any more; every band answers the same question
 * (what advances the pursuit), and the day's logistics come last because they are
 * the least of it. The one figure that used to headline the page — net worth — is
 * now the wealth path's evidence, where it means something.
 */
export async function CommandCenter({ userName }: { userName: string }) {
  const today = sydneyISODate();
  const [
    briefing,
    lang,
    reading,
    gh,
    indexRead,
    riichi,
    tft,
    layout,
    wx,
    choreReads,
    health,
    steps,
    drops,
    aperture,
  ] = await Promise.all([
    getBriefing(),
    getLanguageStats(),
    getCurrentlyReading(),
    getGithub(),
    getSnapIndex(),
    getRiichiStats(),
    getTft(),
    getLayout(),
    getWeather(),
    getChoreReads(),
    getHealth(),
    getSteps(today),
    dropCount(),
    getApertureGlance(),
  ]);
  const b = briefing ?? sampleBriefing;
  // Owner-curated visibility (roadmap 59) — the /system layout panel decides
  // which of these blocks render at all.
  const hidden = hiddenSet(layout, "center");

  // Steps (roadmap: the daily section) — plaintext, server-rendered off the phone's
  // daily push. It is the evidence of whichever path declares it now, rather than a
  // row of its own, so its strip runs the same ten weeks as every other strip in the
  // band. `null` today = nothing posted yet (the honest empty state, a dash).
  const stepsToday = stepsForDay(steps, today);
  const stepsLevels = toLevels(trailingSeries(steps, ACTIVITY_DAYS, today));

  // Reading week-over-week rides the sealed reading index (the cron's plaintext day
  // series), not the retired snapshot store. A store miss or a bad shape → no days →
  // no baseline → the mortal row drops its reading segment rather than reading zero.
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

  // Path evidence — the trailing ten weeks each path's declared series draws, plus
  // the one number beside it. Keyed by the names `paths[].activity` uses, so a path
  // pointing at a series the sheet doesn't carry gets silence, not empty chrome.
  const evidence: GuideEvidence = {
    commits: {
      levels: toLevels(gh.daily.slice(-ACTIVITY_DAYS)),
      value: gh.thisWeek,
    },
    languages: { levels: toLevels(lang.activity), value: lang.thisWeek },
    steps: { levels: stepsLevels, value: stepsToday },
  };

  // The sealed bands the island should draw: the visible aperture units of the three
  // sealed zones, in the owner's configured order. The registry stays the one source
  // of truth for hiding and ordering — the island only obeys this list.
  const sections = SEALED_ZONES.flatMap((zone) =>
    orderedUnitsInZone(layout, "center", zone).map((u) => u.key),
  ).filter((key) => !hidden.has(key));

  // Each command-center module keyed by its layout UNIT key so the zones can
  // render in the owner's configured order (roadmap 59). The values are the
  // exact blocks that used to sit inline, a ternary yielding the JSX when
  // visible.
  const centerNodes: Record<string, ReactNode> = {
    /* exception-only: nothing waiting, nothing on the page. */
    dropbox:
      !hidden.has("dropbox") && drops > 0 ? (
        <DropInbox offline={!r2Enabled()} count={drops} />
      ) : null,

    /* the morning glance rows (roadmap 50+51): Sydney weather is public
       data server-rendered off the keyless Open-Meteo connector; the
       next-trip line is a vault island over the sealed saved trips. */
    weather: !hidden.has("weather") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
          weather
        </span>
        <span className="min-w-0 flex-1 text-fg/90">
          <span className="tabular-nums text-fg">{Math.round(wx.tempC)}°</span>{" "}
          {weatherCodeText(wx.code)}
          {wx.feelsC !== null && ` · feels ${Math.round(wx.feelsC)}°`}
          {wx.uv !== null && (
            <>
              {" · uv "}
              <span className={wx.uv >= 3 ? "text-amber" : "text-fg/90"}>
                {Math.round(wx.uv)}
              </span>{" "}
              {uvLabel(wx.uv)}
            </>
          )}
          {wx.todayMinC !== null &&
            wx.todayMaxC !== null &&
            ` · ${Math.round(wx.todayMinC)}–${Math.round(wx.todayMaxC)}°`}
        </span>
      </div>
    ) : null,

    "transit-next": !hidden.has("transit-next") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
          transit
        </span>
        <span className="min-w-0 flex-1">
          <TransitGlance offline={!r2Enabled()} />
        </span>
      </div>
    ) : null,

    /* today's daily note, parsed: headline + what's still open. A client
       island — the note is sealed in the E2EE vault, so it's fetched +
       decrypted in the browser (unlock in files/), never server-rendered. */
    "vault-today": !hidden.has("vault-today") ? (
      <VaultTodayGlance offline={!r2Enabled()} date={today} />
    ) : null,

    /* quick capture — the E2EE todo list (roadmap 53). A client island:
       captures seal into the meta/todo envelope in the browser; sealed
       dots until the key is in hand. */
    todo: !hidden.has("todo") ? (
      <div className="border-b border-hairline px-4 py-4">
        <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
          capture
        </div>
        <TodoGlance offline={!r2Enabled()} />
      </div>
    ) : null,

    /* briefing — one line, the day's driver. The tape, the relevance
       annotation and the rest of the read live on /briefing. */
    briefing: !hidden.has("briefing") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
          briefing
        </span>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-fg/90">
          {b.driver}
        </span>
        <Link
          href="/briefing"
          className="shrink-0 text-xs text-amber hover:underline"
        >
          [full]
        </Link>
      </div>
    ) : null,

    /* today's hand — solved or not, and a way in. Solving happens in the
       riichi app; nothing here needs more than the state. */
    hand: !hidden.has("hand") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
          riichi
        </span>
        <span className="min-w-0 flex-1 text-fg/90">
          <span lang="ja" className="font-[family-name:var(--font-jp)]">
            本日の一手
          </span>{" "}
          ·{" "}
          {riichi.todaySolved ? (
            <span className="text-up">solved ✓</span>
          ) : (
            "unsolved"
          )}
        </span>
        {!riichi.todaySolved && (
          <Link
            href="/riichi"
            className="shrink-0 text-xs text-amber hover:underline"
          >
            [solve →]
          </Link>
        )}
      </div>
    ) : null,

    /* mortal — the day's small pursuits in one muted line. What's left of the
       retired activity digest: the domains that answer to no path (games, the
       reading count, the raw journal days) still deserve a pulse, but they no
       longer get a row and a trend strip each. The journal segment is a client
       island; it draws its own leading separator so it can vanish while sealed
       without leaving a dangling "·". */
    mortal: !hidden.has("mortal") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
          mortal
        </span>
        <span className="min-w-0 flex-1 text-xs tabular-nums text-muted">
          {mortalSegments({
            riichiStreak: riichi.currentStreak,
            tftGames: tft.gamesThisWeek,
            readingDelta,
          }).map((s, i) => (
            <Fragment key={s.label}>
              {i > 0 && " · "}
              {s.label} <span className="text-amber">{s.value}</span>
              {s.unit && ` ${s.unit}`}
            </Fragment>
          ))}
          <JournalPulse offline={!r2Enabled()} />
        </span>
      </div>
    ) : null,

    /* chores — maintenance freshness derived from evidence (roadmap 52):
       vault-sync + backup are server-read, the csv chore decrypts the fin
       envelope client-side, so the whole row is an island. Exception-only —
       it names what's gone due and stays silent otherwise. */
    chores: !hidden.has("chores") ? (
      <ChoresRow
        offline={!r2Enabled()}
        vaultSync={choreState(
          choreReads.vaultSyncedAt,
          CHORE_CADENCE_DAYS.vaultSync,
          new Date(),
        )}
        backup={choreState(
          choreReads.backupAt,
          CHORE_CADENCE_DAYS.backup,
          new Date(),
        )}
      />
    ) : null,

    /* health — is the estate up (roadmap 55): one capped probe per sibling
       project, cached 5 min. Exception-only: a healthy estate says nothing,
       and only the offenders are named. */
    health:
      !hidden.has("health") && health.some((h) => h.state !== "ok") ? (
        <div className="flex items-baseline gap-3 border-t border-hairline px-4 py-2.5 text-sm">
          <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
            health
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
            {health
              .filter((h) => h.state !== "ok")
              .map((h) => (
                <span key={h.key} className="text-xs">
                  <span className="text-muted">{h.label}</span>{" "}
                  {h.state === "down" ? (
                    <span className="text-down">✕ down</span>
                  ) : (
                    <>
                      <span className="text-amber">●</span>
                      {h.ms !== null && (
                        <span className="tabular-nums text-muted">
                          {" "}
                          {h.ms}ms
                        </span>
                      )}
                    </>
                  )}
                </span>
              ))}
          </span>
        </div>
      ) : null,
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={userName} />

        {/* encrypted drop box — a client island behind the vault unlock; sealed
            messages left on /contact open here and nowhere else (ADR: sealed box). */}
        {centerNodes.dropbox}

        {/* the rank, off the plaintext glance — fixed chrome, never a unit. */}
        <ApertureMasthead glance={aperture} />

        {/* the sealed sheet: four bands, one envelope, one decrypt. Mounted only
            when there IS a rank to stand behind (no glance means nothing was ever
            sealed, so there is nothing to unlock toward) and only when the owner has
            left at least one of its bands visible. */}
        {aperture && sections.length > 0 && (
          <GuideSealed
            sections={sections}
            evidence={evidence}
            today={today}
            offline={!r2Enabled()}
          />
        )}

        {/* zones render from the owner's layout order (roadmap 59); the default
            order reproduces the hand-tuned layout. A zone's divider appears only
            when the zone actually has something to say — a band whose every unit
            is hidden (or quiet) announces nothing. */}
        {ZONES.map(({ zone, label, right }) => {
          const units = orderedUnitsInZone(layout, "center", zone).filter(
            (u) => centerNodes[u.key] != null,
          );
          if (units.length === 0) return null;
          return (
            <Fragment key={zone}>
              {label && <ZoneHeader label={label} right={right?.()} />}
              {units.map((u) => (
                <Fragment key={u.key}>{centerNodes[u.key]}</Fragment>
              ))}
            </Fragment>
          );
        })}

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
              href="/ishin"
              className="text-muted transition-colors hover:text-amber"
            >
              ishin/
            </Link>
            <Link
              href="/reader"
              className="text-muted transition-colors hover:text-amber"
            >
              reader/
            </Link>
            <Link
              href="/transit"
              className="text-muted transition-colors hover:text-amber"
            >
              transit/
            </Link>
            <Link
              href="/gym"
              className="text-muted transition-colors hover:text-amber"
            >
              gym/
            </Link>
            <Link
              href="/vault"
              className="text-muted transition-colors hover:text-amber"
            >
              vault/
            </Link>
            <Link
              href="/files"
              className="text-muted transition-colors hover:text-amber"
            >
              files/
            </Link>
            <Link
              href="/system"
              className="text-muted transition-colors hover:text-amber"
            >
              system/
            </Link>
            <SignOut className="text-muted transition-colors hover:text-amber" />
          </nav>
          <CommandK />
        </div>
      </div>
    </main>
  );
}
