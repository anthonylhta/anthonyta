import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { AgendaRow } from "@/components/AgendaRow";
import { SignOut } from "@/components/auth-buttons";
import { DropInbox } from "@/components/DropInbox";
import { JournalPulse } from "@/components/JournalPulse";
import { MealsGlance } from "@/components/MealsGlance";
import { MeSealed } from "@/components/MeSealed";
import { NeedsDoing } from "@/components/NeedsDoing";
import { CommandK } from "@/components/terminal/CommandPalette";
import { LabelDoor } from "@/components/terminal/LabelDoor";
import { StatusBar } from "@/components/terminal/StatusBar";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { TftModule } from "@/components/TftModule";
import { TransitGlance } from "@/components/TransitGlance";
import { VaultTodayGlance } from "@/components/VaultTodayGlance";
import { CHORE_CADENCE_DAYS, choreState } from "@/lib/chores";
import { getApertureGlance } from "@/lib/connectors/aperture";
import { getBriefing } from "@/lib/connectors/briefing";
import { getChoreReads } from "@/lib/connectors/chores";
import { getHealth } from "@/lib/connectors/health";
import { getLayout } from "@/lib/connectors/layout";
import { getRiichiStats } from "@/lib/connectors/riichi";
import { getTft, getTftHistory } from "@/lib/connectors/tft";
import { getWeather } from "@/lib/connectors/weather";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { listDrops } from "@/lib/dropstore";
import {
  indexBaseline,
  isSnapIndex,
  sydneyDaysAgo,
  type SnapIndexDay,
} from "@/lib/fin";
import { essenceOf } from "@/lib/aperture";
import { essenceVarClass, mortalSegments } from "@/lib/apertureview";
import {
  hiddenSet,
  orderedUnitsInZone,
  type Zone as CenterZone,
} from "@/lib/layout";
import { quoteForDay } from "@/lib/quotes";
import {
  rainLabelFor,
  sydneyHour,
  uvLabel,
  weatherCodeText,
} from "@/lib/weather";
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

/** The zones this page renders, top to bottom, with the divider each one gets.
 *  TODAY is the only one left: the me-block above it is fixed chrome, and every
 *  status band is the aperture READING, which moved to /aperture entire. */
const ZONES: { zone: CenterZone; label?: string; right?: () => string }[] = [
  { zone: "today", label: "today", right: todayLabel },
];

/** The public name — the same one the lobby carries, not the session's. Who this
 *  page is about is a fact about the page, not about which credential opened it. */
const NAME = "anthony ta";

/**
 * Your private daily driver — what `/` becomes when you're logged in (ADR 0004).
 * The page is about ME: who I am, what I'm doing, what I'm worth, and one line
 * worth carrying — then TODAY, the day's rows plus the exception rows that only
 * speak when something is due or down.
 *
 * IT IS WARM TERMINAL, PLAINLY. The character sheet's bands, its essence colours,
 * its seals and its ornaments all live on /aperture now, behind the single door in
 * the me-block: the sheet is a thing you go and READ, and the page landed on twenty
 * times a day should be the day. The one sanctioned exception is the breakthrough
 * flourish (roadmap 70a), which has to fire where the owner actually is.
 *
 * The only cultivation ink left up here is the rank word — muted, lowercase, in the
 * same line as the city, a fact about oneself the way an age is.
 */
export async function CommandCenter({ userName }: { userName: string }) {
  const today = sydneyISODate();
  const [
    briefing,
    reading,
    indexRead,
    riichi,
    tft,
    tftHistory,
    layout,
    wx,
    choreReads,
    health,
    drops,
    aperture,
  ] = await Promise.all([
    getBriefing(),
    getCurrentlyReading(),
    getSnapIndex(),
    getRiichiStats(),
    getTft(),
    getTftHistory(),
    getLayout(),
    getWeather(),
    getChoreReads(),
    getHealth(),
    dropCount(),
    getApertureGlance(),
  ]);
  const b = briefing ?? sampleBriefing;
  // Owner-curated visibility (roadmap 59) — the /system layout panel decides
  // which of these blocks render at all.
  const hidden = hiddenSet(layout, "center");

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

  // The weather row's rain flag — exception-weighted, so it's null on a
  // day the sky isn't worth mentioning. Read against the hour here at render
  // rather than inside the 15-minute cached Weather: which hours are still
  // ahead of us is the one part of it that goes stale by the minute.
  const rain = rainLabelFor(wx, sydneyHour());

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
          {rain && (
            <>
              {" · "}
              <span
                className={rain.tone === "amber" ? "text-amber" : "text-muted"}
              >
                {rain.text}
              </span>
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
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em]">
          <LabelDoor href="/transit" label="transit" />
        </span>
        <span className="min-w-0 flex-1">
          <TransitGlance offline={!r2Enabled()} />
        </span>
      </div>
    ) : null,

    /* agenda — what's ahead, and the only place it's written down. A vault
       island: every event is sealed in `meta/agenda`, so the schedule is
       decrypted (and added to) in the browser. Always rendered — an entry
       surface has to exist to be entered into, the same 0109 exception the
       needs-doing board and the meals row take. */
    agenda: !hidden.has("agenda") ? (
      /* The one today-zone unit that drops the side label on a phone: five
         columns per event can't share a narrow screen with it, so the label
         moves above (the needs-doing treatment) and the rows get full width. */
      <div className="border-b border-hairline px-4 py-2.5 text-sm sm:flex sm:items-baseline sm:gap-3">
        <span className="mb-1.5 block text-[11px] uppercase tracking-[0.2em] sm:mb-0 sm:w-20 sm:shrink-0 sm:tracking-[0.12em]">
          <LabelDoor href="/agenda" label="agenda" />
        </span>
        <div className="min-w-0 sm:flex-1">
          <AgendaRow offline={!r2Enabled()} today={today} />
        </div>
      </div>
    ) : null,

    /* today's daily note, parsed: headline + what's still open. A client
       island — the note is sealed in the E2EE vault, so it's fetched +
       decrypted in the browser (unlock in files/), never server-rendered. */
    "vault-today": !hidden.has("vault-today") ? (
      <VaultTodayGlance offline={!r2Enabled()} date={today} />
    ) : null,

    /* needs doing — the day's board (roadmap 72): the E2EE captures, the life
       cadences derived from their own evidence, and the hub's upkeep with the
       command to run. A client island for the sealed halves; the three chore
       states the server can see ride in as props. Always rendered — a surface
       you consult has to exist to be consulted. */
    todo: !hidden.has("todo") ? (
      <div className="border-b border-hairline px-4 py-4">
        <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
          needs doing
        </div>
        <NeedsDoing
          offline={!r2Enabled()}
          today={today}
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
          aperture={choreState(
            choreReads.apertureSealedAt,
            CHORE_CADENCE_DAYS.aperture,
            new Date(),
          )}
        />
      </div>
    ) : null,

    /* meals — the day's macros against their targets, protein first. A vault
       island: the food library and everything eaten are sealed in `meta/meals`,
       so the bars are drawn in the browser. Always rendered — a tracker you
       have to see in order to log against is the 0109 exception. */
    meals: !hidden.has("meals") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em]">
          <LabelDoor href="/meals" label="meals" />
        </span>
        <span className="min-w-0 flex-1">
          <MealsGlance offline={!r2Enabled()} today={today} />
        </span>
      </div>
    ) : null,

    /* briefing — one line, the day's driver. The tape, the relevance
       annotation and the rest of the read live on /briefing. */
    briefing: !hidden.has("briefing") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em]">
          <LabelDoor href="/briefing" label="briefing" />
        </span>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-fg/90">
          {b.driver}
        </span>
      </div>
    ) : null,

    /* today's hand — solved or not, and a way in. Solving happens in the
       riichi app; nothing here needs more than the state. */
    hand: !hidden.has("hand") ? (
      <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em]">
          <LabelDoor href="/riichi" label="riichi" />
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

    /* arena — the full tft band, same module the lobby renders (rank, comps
       fold, ladder trend), back on the center as an owner call so the comps
       table is reachable signed in. The mortal pulse keeps its one-number
       glance; this is the detail. */
    arena: !hidden.has("arena") ? (
      <TftModule tft={tft} history={tftHistory} edge="b" />
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

  // The rank, as the one word the me-block prints of it: the canon essence name,
  // lowercased and muted, off the PLAINTEXT glance. No glance, no word — the page
  // says nothing about a rank nothing was ever sealed for.
  const essence = aperture ? essenceOf(aperture.rank, aperture.stage) : null;
  const rankWord = essence?.toLowerCase() ?? null;
  // The day's line. Tiered by rank, so the plaintext glance is enough to choose it;
  // with no glance the first tier stands in, since a line is public text either way.
  const quote = quoteForDay(aperture?.rank ?? 1, today);

  return (
    // The skin attribute and the essence variable survive on this page for ONE
    // reason: the breakthrough flourish (ADR 0119) is scoped to them — it lays the
    // old essence on this container and sweeps the variable to the new one. None of
    // the skin's chrome is worn up here any more (no wash, no stamps, no masonry,
    // no gutters — all of it moved to /aperture with the reading), so what the
    // attribute buys is a moment once per breakthrough and nothing else.
    <main
      data-skin={aperture ? "cultivation" : undefined}
      className={`mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6 ${
        aperture ? essenceVarClass(essence) : ""
      }`}
    >
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={userName} />

        {/* encrypted drop box — a client island behind the vault unlock; sealed
            messages left on /contact open here and nowhere else (ADR: sealed box). */}
        {centerNodes.dropbox}

        {/* who this is, what he's doing, what he's worth, and the door inward —
            fixed chrome, never a unit. */}
        <MeSealed
          offline={!r2Enabled()}
          name={NAME}
          rankWord={rankWord}
          quote={quote}
          glance={aperture}
          today={today}
        />

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

        {/* quick jumps — only the pages with no section of their own. Everything
            else is reached through its row's label door (aperture through the
            me-block), so the list stays short enough to scan. */}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-sm">
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
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
              href="/gym"
              className="text-muted transition-colors hover:text-amber"
            >
              gym/
            </Link>
            <Link
              href="/portfolio"
              className="text-muted transition-colors hover:text-amber"
            >
              portfolio/
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
