import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ApertureBand } from "@/components/ApertureBand";
import { SignOut } from "@/components/auth-buttons";
import { ChoresRow } from "@/components/ChoresRow";
import { DropInbox } from "@/components/DropInbox";
import { JournalActivityRow } from "@/components/JournalActivityRow";
import { NetWorthGlance } from "@/components/NetWorthGlance";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { CommandK } from "@/components/terminal/CommandPalette";
import { StatusBar } from "@/components/terminal/StatusBar";
import { TodoGlance } from "@/components/TodoGlance";
import { TransitGlance } from "@/components/TransitGlance";
import { VaultTodayGlance } from "@/components/VaultTodayGlance";
import {
  ACTIVITY_DAYS,
  dailyCounts,
  dailyDeltas,
  toLevels,
} from "@/lib/activity";
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
import {
  hiddenSet,
  orderedUnitsInZone,
  type Zone as CenterZone,
} from "@/lib/layout";
import {
  commas,
  STEPS_STRIP_DAYS,
  stepsForDay,
  trailingSeries,
} from "@/lib/steps";
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

/** The zones this page renders, top to bottom, and the divider each one gets. The
 *  sheet's three status bands are deliberately UNLABELLED for now: their chrome
 *  arrives with the shell, and a header over a single bridged band would announce
 *  a structure that isn't built yet. */
const ZONES: { zone: CenterZone; label?: string; right?: () => string }[] = [
  { zone: "wall" },
  { zone: "paths" },
  { zone: "trials" },
  { zone: "today", label: "today", right: todayLabel },
];

/**
 * Your private daily driver — what `/` becomes when you're logged in (ADR 0004).
 * The zones come from the layout registry (roadmap 59) and render in its order:
 * the wall being worked, the paths, the trials, then TODAY — the day's rows and
 * the exception rows that only speak when something is due or down.
 *
 * MID-REDESIGN: the three status bands hold only the v1 aperture band (bridged
 * onto the `aperture-wall` unit) and the activity digest still renders as the
 * `week` unit at the end of TODAY. Both are temporary — the shell replaces them.
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
  // daily push; today's count + a trailing fortnight strip. `null` today = nothing
  // posted yet (the honest empty state).
  const stepsToday = stepsForDay(steps, today);
  const stepsLevels = toLevels(trailingSeries(steps, STEPS_STRIP_DAYS, today));

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
    {
      k: "tft",
      value: <span className="text-amber">+{tft.gamesThisWeek}</span>,
      levels: toLevels(dailyCounts(tft.matchDates, ACTIVITY_DAYS, today)),
    },
  ];

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

    /* aperture — the private status band. The ONE deliberate standing block
       (ADR 0109's exception-only rule acknowledged): the status display IS the
       reminder surface, so it has no quiet state to hide in. Rank + stage are
       server-rendered off the plaintext glance; the rest is a vault island.
       BRIDGE: the v1 band hangs on the `aperture-wall` unit until the shell
       splits it into the wall, conditions, paths and trials bands. */
    "aperture-wall": !hidden.has("aperture-wall") ? (
      <ApertureBand glance={aperture} offline={!r2Enabled()} />
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

    /* steps — the daily count off the phone's plaintext push (Samsung Health →
       Health Connect); today's number + a trailing 14-day strip. Exception-only:
       with nothing pushed yet there's no row at all rather than an empty state,
       and a today-less strip reads as a muted dash. */
    steps:
      !hidden.has("steps") &&
      (stepsToday !== null || stepsLevels.some((l) => l > 0)) ? (
        <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
          <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
            steps
          </span>
          <span className="min-w-0 flex-1 text-fg/90">
            {stepsToday !== null ? (
              <span className="tabular-nums text-fg">{commas(stepsToday)}</span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </span>
          {stepsLevels.some((l) => l > 0) && (
            <span className="w-24 shrink-0">
              <ActivityStrip levels={stepsLevels} label="steps, last 14 days" />
            </span>
          )}
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

    /* net worth — a glance; full holdings + cash live on /portfolio. The
       numbers are a client island: everything rides the E2EE fin envelope
       (ADR 0061) and decrypts in the browser — sealed dots until unlocked. */
    networth: !hidden.has("networth") ? (
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

    week: !hidden.has("week") ? (
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
              {label && <Zone label={label} right={right?.()} />}
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

/** A zone divider — the band headers the sheet reads down. */
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
