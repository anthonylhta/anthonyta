import Link from "next/link";
import { BreakthroughMoment } from "@/components/BreakthroughMoment";
import { ExceptionLine } from "@/components/terminal/ExceptionLine";
import { essenceOf, isSealStale, type ApertureGlance } from "@/lib/aperture";
import { essenceTextClass, membraneOf, sealedAgo } from "@/lib/apertureview";

/**
 * ApertureMasthead — the summary page's head, and the door to the full reading.
 * Fixed chrome above every band, like the status bar: not a layout unit, because
 * where one stands is not a module the owner can reorder away from the top.
 *
 * It is the ESSENCE SEA the inward page leads with, rendered here too — the same
 * band, the same words, so the home page and /aperture read as one surface with a
 * door between them rather than two mastheads that drifted. The whole band IS the
 * door; the muted line under it says so in words as well, because a link nothing
 * points at is a link nobody finds.
 *
 * Server-rendered from the plaintext glance — rank, stage and the seal instant are
 * the only part of the status that isn't sealed (ADR: plaintext ≠ public). It renders
 * owner-only BY CONSTRUCTION: the command center is behind the session gate and the
 * guest lobby never mounts this, which is exactly the property the guest-HTML e2e
 * lock pins. Nothing here weakens that; there is no guest branch to get wrong.
 *
 * The large numeral, the 命 stamp and the streak meta line all moved off this head
 * with the restructure: the page below is a summary now, and a rank stated twice at
 * two zooms is the bloat the summary exists to undo.
 */

/** Both clock-dependent readings off ONE instant, so the age and the staleness can
 *  never disagree. Read in a helper rather than the render body the way
 *  `todayLabel()` is: the command center is dynamic, so a per-request clock is
 *  exactly right, but render itself stays pure. */
function freshness(glance: ApertureGlance): {
  ago: string | null;
  stale: boolean;
} {
  const now = new Date().getTime();
  return {
    ago: sealedAgo(glance.sealedAt, now),
    stale: isSealStale(glance.sealedAt, now),
  };
}

/**
 * The one muted line under the sea: how old the seal is, and the way in. The band
 * above it already links, so this is discoverability rather than navigation — it
 * renders in BOTH of the masthead's states, unplaced included, because the page
 * behind it owns the empty case and says so in its own words, which is a better
 * answer than a missing door and no way to find out why.
 */
function MetaLine({ ago }: { ago: string | null }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted">
      {ago && <span className="tabular-nums">{ago}</span>}
      <Link
        href="/aperture"
        className="text-(--essence) transition-colors hover:text-amber"
      >
        aperture →
      </Link>
    </p>
  );
}

export function ApertureMasthead({
  glance,
}: {
  glance: ApertureGlance | null;
}) {
  if (!glance) {
    // No glance at all — nothing synced, or a read that failed. One muted line, and
    // the command center mounts NO island beside it: there is no rank to stand behind,
    // so there is nothing to unlock toward and an "unlock" nudge would be an
    // invitation to open a door with nothing behind it. This branch owns the hairline
    // for the same reason — nothing follows it.
    return (
      <div className="border-b border-hairline px-4 py-4">
        <p className="mb-2 text-xs text-muted">unplaced — run aperture-sync</p>
        <MetaLine ago={null} />
      </div>
    );
  }

  const { ago, stale } = freshness(glance);
  const essence = essenceOf(glance.rank, glance.stage);
  const membrane = membraneOf(glance.stage);

  return (
    <div>
      {/* the essence sea — the colour the rank names, where one stands inside it,
          and the aperture glyph. The whole band is the door: one block-level link,
          so the target is the size of the thing it is about. */}
      <Link
        href="/aperture"
        aria-label="aperture — the full reading"
        className="block border-l-2 border-l-(--essence) bg-(--essence-faint) px-4 py-4 transition-opacity hover:opacity-90"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            {/* off canon there is no colour name to print, so the stage itself
                stands in — muted by `essenceTextClass`, never a colour nobody
                assigned. */}
            <p className={`text-2xl leading-none ${essenceTextClass(essence)}`}>
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
      </Link>

      <div className="px-4 pb-3 pt-2">
        {/* the breakthrough flourish — a client island in the register of the band
            it sits under, silent on every load but the first after a rank or stage
            moved (roadmap 70a) */}
        <BreakthroughMoment rank={glance.rank} stage={glance.stage} />
        <MetaLine ago={ago} />
        {/* A late seal is the owner's own lateness, not an error — so it joins the
            exception band in amber rather than lighting a red line. It lives here
            rather than in the sealed island because staleness is a fact about the
            PLAINTEXT glance: this component holds it, and no key is needed to say it. */}
        {stale && (
          <ExceptionLine tone="amber">
            seal stale — run aperture-sync
          </ExceptionLine>
        )}
      </div>
    </div>
  );
}
