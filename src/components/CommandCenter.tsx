import type { ReactNode } from "react";
import Link from "next/link";
import { SignOut } from "@/components/auth-buttons";
import { BriefingRelevance } from "@/components/BriefingRelevance";
import { ChoreChip } from "@/components/ChoreChip";
import { ChoreCsvChip } from "@/components/ChoreCsvChip";
import { DropInbox } from "@/components/DropInbox";
import { JournalActivityRow } from "@/components/JournalActivityRow";
import { NetWorthGlance } from "@/components/NetWorthGlance";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { CommandK } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import { TftModule } from "@/components/TftModule";
import { TodoGlance } from "@/components/TodoGlance";
import { TotpDrawer } from "@/components/TotpDrawer";
import { TransitGlance } from "@/components/TransitGlance";
import { VaultTodayGlance } from "@/components/VaultTodayGlance";
import {
  ACTIVITY_DAYS,
  dailyCounts,
  dailyDeltas,
  toLevels,
} from "@/lib/activity";
import { CHORE_CADENCE_DAYS, choreState } from "@/lib/chores";
import { getBriefing } from "@/lib/connectors/briefing";
import { getChoreReads } from "@/lib/connectors/chores";
import { getGithub } from "@/lib/connectors/github";
import { getHealth } from "@/lib/connectors/health";
import { getLayout } from "@/lib/connectors/layout";
import { getRiichiStats } from "@/lib/connectors/riichi";
import { getTft, getTftHistory } from "@/lib/connectors/tft";
import { getLanguageStats } from "@/lib/connectors/translator";
import { getWeather } from "@/lib/connectors/weather";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import {
  indexBaseline,
  isSnapIndex,
  sydneyDaysAgo,
  type SnapIndexDay,
} from "@/lib/fin";
import { hiddenSet } from "@/lib/layout";
import { uvLabel, weatherCodeText } from "@/lib/weather";
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
  const [
    briefing,
    lang,
    reading,
    gh,
    indexRead,
    riichi,
    tft,
    tftHistory,
    layout,
    wx,
    choreReads,
    health,
  ] = await Promise.all([
    getBriefing(),
    getLanguageStats(),
    getCurrentlyReading(),
    getGithub(),
    getSnapIndex(),
    getRiichiStats(),
    getTft(),
    getTftHistory(),
    getLayout(),
    getWeather(),
    getChoreReads(),
    getHealth(),
  ]);
  const b = briefing ?? sampleBriefing;
  // Owner-curated visibility (roadmap 59) — the /system layout panel decides
  // which of these blocks render at all.
  const hidden = hiddenSet(layout, "center");
  const todayVisible = [
    "weather",
    "transit-next",
    "networth",
    "vault-today",
    "todo",
    "briefing",
    "hand",
  ].some((k) => !hidden.has(k));

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
    {
      k: "tft",
      value: <span className="text-amber">+{tft.gamesThisWeek}</span>,
      levels: toLevels(dailyCounts(tft.matchDates, ACTIVITY_DAYS, today)),
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

        {/* encrypted drop box — a client island behind the vault unlock; sealed
            messages left on /contact open here and nowhere else (ADR: sealed box). */}
        {!hidden.has("dropbox") && <DropInbox offline={!r2Enabled()} />}

        {/* ───────────── TODAY ───────────── */}
        {todayVisible && <Zone label="today" right={todayLabel()} />}

        {/* the morning glance rows (roadmap 50+51): Sydney weather is public
            data server-rendered off the keyless Open-Meteo connector; the
            next-trip line is a vault island over the sealed saved trips. */}
        {!hidden.has("weather") && (
          <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
            <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
              weather
            </span>
            <span className="min-w-0 flex-1 text-fg/90">
              <span className="tabular-nums text-fg">
                {Math.round(wx.tempC)}°
              </span>{" "}
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
        )}
        {!hidden.has("transit-next") && (
          <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-2.5 text-sm">
            <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
              transit
            </span>
            <span className="min-w-0 flex-1">
              <TransitGlance offline={!r2Enabled()} />
            </span>
          </div>
        )}

        {/* net worth — a glance; full holdings + cash live on /portfolio. The
            numbers are a client island: everything rides the E2EE fin envelope
            (ADR 0061) and decrypts in the browser — sealed dots until unlocked. */}
        {!hidden.has("networth") && (
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
        )}

        {/* today's daily note, parsed: headline + planner + a journal peek. A
            client island — the note is sealed in the E2EE vault, so it's fetched +
            decrypted in the browser (unlock in files/), never server-rendered. */}
        {!hidden.has("vault-today") && (
          <VaultTodayGlance offline={!r2Enabled()} date={today} />
        )}

        {/* quick capture — the E2EE todo list (roadmap 53). A client island:
            captures seal into the meta/todo envelope in the browser; sealed
            dots until the key is in hand. */}
        {!hidden.has("todo") && (
          <div className="border-b border-hairline px-4 py-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
              capture
            </div>
            <TodoGlance offline={!r2Enabled()} />
          </div>
        )}

        {(!hidden.has("briefing") || !hidden.has("hand")) && (
          <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2">
            {!hidden.has("briefing") && (
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
                <BriefingRelevance briefing={b} offline={!r2Enabled()} />
              </Module>
            )}

            {!hidden.has("hand") && (
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
            )}
          </div>
        )}

        {/* ──────────── THIS WEEK ──────────── */}
        {!hidden.has("week") && (
          <>
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
          </>
        )}

        {/* chores — maintenance freshness derived from evidence (roadmap 52):
            vault-sync + backup are server-read; the csv chip decrypts the fin
            envelope client-side. */}
        {!hidden.has("chores") && (
          <div className="flex items-baseline gap-3 border-t border-hairline px-4 py-2.5 text-sm">
            <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
              chores
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
              <ChoreCsvChip offline={!r2Enabled()} />
              <ChoreChip
                label="vault-sync"
                state={choreState(
                  choreReads.vaultSyncedAt,
                  CHORE_CADENCE_DAYS.vaultSync,
                  new Date(),
                )}
              />
              <ChoreChip
                label="backup"
                state={choreState(
                  choreReads.backupAt,
                  CHORE_CADENCE_DAYS.backup,
                  new Date(),
                )}
              />
            </span>
          </div>
        )}

        {/* health — is the estate up (roadmap 55): one capped probe per
            sibling project, cached 5 min. */}
        {!hidden.has("health") && (
          <div className="flex items-baseline gap-3 border-t border-hairline px-4 py-2.5 text-sm">
            <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
              health
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
              {health.map((h) => (
                <span key={h.key} className="text-xs">
                  <span className="text-muted">{h.label}</span>{" "}
                  {h.state === "down" ? (
                    <span className="text-down">✕ down</span>
                  ) : (
                    <>
                      <span
                        className={
                          h.state === "slow" ? "text-amber" : "text-up"
                        }
                      >
                        ●
                      </span>
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
        )}

        {/* arena — the same band the lobby shows (rank, recent games, drill-down),
            so the owner doesn't have to sign out to see it. The THIS WEEK tft row
            keeps the cadence; this is the standing (deliberate 0032 dent). */}
        {!hidden.has("tft") && <TftModule tft={tft} history={tftHistory} />}

        {/* 2fa — seeds sealed in the vault, codes computed in-browser behind the
            unlock (ADR: TOTP drawer); the server never sees a seed or a code. */}
        {!hidden.has("totp") && (
          <div className="border-t border-hairline px-4 py-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
              2fa
            </div>
            <TotpDrawer offline={!r2Enabled()} />
          </div>
        )}

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
              href="/reader"
              className="text-amber/80 transition-colors hover:text-amber"
            >
              reader/
            </Link>
            <Link
              href="/transit"
              className="text-amber/80 transition-colors hover:text-amber"
            >
              transit/
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
            <Link
              href="/system"
              className="text-amber/80 transition-colors hover:text-amber"
            >
              system/
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
