import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { ApertureInner } from "@/components/ApertureInner";
import { ExceptionLine } from "@/components/terminal/ExceptionLine";
import { StatusBar } from "@/components/terminal/StatusBar";
import { ACTIVITY_DAYS, toLevels } from "@/lib/activity";
import { essenceOf, isSealStale, type ApertureGlance } from "@/lib/aperture";
import {
  essenceTextClass,
  essenceVarClass,
  gutterPhrase,
  membraneOf,
  sealedAgo,
  type PathSeries,
} from "@/lib/apertureview";
import { getApertureGlance } from "@/lib/connectors/aperture";
import { getGithub } from "@/lib/connectors/github";
import { getSleep } from "@/lib/connectors/sleep";
import { getSteps } from "@/lib/connectors/steps";
import { getLanguageStats } from "@/lib/connectors/translator";
import { sydneyToday } from "@/lib/fin";
import { r2Enabled } from "@/lib/r2";
import { weekAverage as sleepWeekAverage } from "@/lib/sleep";
import { stepsForDay, trailingSeries, weekAverage } from "@/lib/steps";

export const metadata = { title: "aperture" };

/**
 * How old the reading is, and whether the week has run away from it — both off ONE
 * instant, so the age and the staleness can never disagree. Read in a helper rather
 * than the render body: the page is dynamic, so a per-request clock is exactly
 * right, but render itself stays pure.
 *
 * Freshness is a fact about the PLAINTEXT glance — no key is needed to say how old a
 * seal is — which is why it is stated out here rather than inside the island where
 * everything else about the seal lives.
 */
function freshness(glance: ApertureGlance | null): {
  ago: string | null;
  stale: boolean;
} {
  if (!glance) return { ago: null, stale: false };
  const now = new Date().getTime();
  return {
    ago: sealedAgo(glance.sealedAt, now),
    stale: isSealStale(glance.sealedAt, now),
  };
}

// The full reading — owner-only, and everything under the header decrypts in the
// browser.
export const dynamic = "force-dynamic";

export default async function AperturePage() {
  // Owner-only: guests get a 404 (ADR 0022). The rank in the header is plaintext
  // at rest but renders only past this gate, and everything below it lives inside
  // the E2EE aperture and fin envelopes — the server renders the shell alone.
  const session = await auth();
  if (!session?.user) notFound();

  const who = session.user.name ?? "anthony";
  const today = sydneyToday();
  const [glance, gh, lang, steps, sleep] = await Promise.all([
    getApertureGlance(),
    getGithub(),
    getLanguageStats(),
    getSteps(today),
    getSleep(today),
  ]);
  const essence = glance ? essenceOf(glance.rank, glance.stage) : null;
  const membrane = glance ? membraneOf(glance.stage) : null;
  const phrase = glance ? gutterPhrase(glance.rank) : null;
  const { ago, stale } = freshness(glance);

  // Path evidence — the trailing ten weeks each path's declared series draws, plus
  // the one number beside it. Keyed by the names `paths[].activity` uses, so a path
  // pointing at a series this build doesn't carry gets silence, not empty chrome.
  // The gym series is missing on purpose: it lives in an E2EE envelope, so the
  // island decrypts it and merges it in.
  const series: PathSeries = {
    commits: {
      levels: toLevels(gh.daily.slice(-ACTIVITY_DAYS)),
      value: gh.thisWeek,
    },
    languages: { levels: toLevels(lang.activity), value: lang.thisWeek },
    steps: {
      levels: toLevels(trailingSeries(steps, ACTIVITY_DAYS, today)),
      value: stepsForDay(steps, today),
    },
  };

  return (
    // The cultivation skin (ADR 0118) rides the container, unconditionally here
    // where the command center makes it conditional: this page IS the full
    // reading, and off the canon `essenceVarClass` already resolves to muted — so
    // an unplaced sheet degrades to neutral chrome rather than losing the stamps
    // and washes the page is drawn in.
    <main
      data-skin="cultivation"
      className={`skin-wash mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6 ${essenceVarClass(
        essence,
      )}`}
    >
      {/* vertical ink ornaments — fixed in the page gutters, wide desktop only
          (CSS hides them long before they could crowd the reading) */}
      {glance && (
        <>
          <div aria-hidden lang="zh" className="skin-gutter skin-gutter-l">
            {phrase}
            <span className="skin-gutter-stroke" />
          </div>
          <div aria-hidden lang="zh" className="skin-gutter skin-gutter-r">
            观微知著
          </div>
        </>
      )}
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            aperture
          </span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        {/* the essence sea — the one band that needs no key: rank, stage and the
            colour they name, off the plaintext glance. The home page prints the
            colour's NAME and nothing more; here is where it is worn. */}
        {glance ? (
          <div className="flex items-start justify-between gap-3 border-b border-hairline border-l-2 border-l-(--essence) bg-(--essence-faint) px-4 py-4">
            <div>
              <p
                className={`text-2xl leading-none ${essenceTextClass(essence)}`}
              >
                {essence ?? glance.stage}
              </p>
              <p className="mt-1.5 text-xs text-muted">
                rank {glance.rank} · {glance.stage}
                {membrane && ` — ${membrane}`}
              </p>
            </div>
            <span
              aria-hidden
              lang="zh"
              className="font-[family-name:var(--font-zh)] text-[34px] leading-none text-(--essence) opacity-80"
            >
              竅
            </span>
          </div>
        ) : (
          // Nothing sealed, or a read that failed. This page owns the empty case:
          // the home page says nothing about a rank rather than nothing-yet.
          <div className="border-b border-hairline px-4 py-4">
            <p className="text-xs text-muted">unplaced — run aperture-sync</p>
          </div>
        )}

        {/* how old the reading is, and — when the week has run away from it — the
            one line that says so. Amber, not red: a late seal is the owner's own
            lateness, not something broken. */}
        {(ago || stale) && (
          <div className="border-b border-hairline px-4 py-2.5">
            {ago && (
              <p className="text-[11px] tabular-nums text-muted">{ago}</p>
            )}
            {stale && (
              <ExceptionLine tone="amber">
                seal stale — run aperture-sync
              </ExceptionLine>
            )}
          </div>
        )}

        <ApertureInner
          offline={!r2Enabled()}
          series={series}
          sleepWeekAvg={sleepWeekAverage(sleep, today)}
          stepsWeekAvg={weekAverage(steps, today)}
          today={today}
        />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
