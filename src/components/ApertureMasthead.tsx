import Link from "next/link";
import { BreakthroughMoment } from "@/components/BreakthroughMoment";
import { essenceOf, isSealStale, type ApertureGlance } from "@/lib/aperture";
import {
  bandLine,
  displayNumeral,
  essenceSwatchClass,
  essenceTextClass,
  familyOf,
  sealedAgo,
  stageGlyphs,
} from "@/lib/apertureview";

/**
 * ApertureMasthead — the character sheet's head. Fixed chrome above every band, like
 * the status bar: not a layout unit, because the rank is not a module the owner can
 * reorder away from the top. The page IS the sheet, and a sheet leads with its rank.
 *
 * Server-rendered from the plaintext glance — rank, stage and the seal instant are
 * the only part of the status that isn't sealed (ADR: plaintext ≠ public). It renders
 * owner-only BY CONSTRUCTION: the command center is behind the session gate and the
 * guest lobby never mounts this, which is exactly the property the guest-HTML e2e
 * lock pins. Nothing here weakens that; there is no guest branch to get wrong.
 *
 * The essence hue lives in the bar, the swatch and the colour's NAME. The rank line
 * itself stays warm off-white: it is the loudest type on the page, and the one
 * headline figure the design allows does not also need to be coloured.
 *
 * No bottom border, deliberately — the sealed island's meta line continues this
 * block (streaks, vital gu, the adjudication dot), so the hairline belongs to
 * whatever renders below rather than cutting the meta in half.
 */

/** Both clock-dependent readings off ONE instant, so the age and the staleness dot
 *  can never disagree. Read in a helper rather than the render body the way
 *  `todayLabel()` is: the command center is dynamic, so a per-request clock is
 *  exactly right, but render itself stays pure. */
/**
 * The way in — the sheet reads outward (rank, wall, paths, the day), the page
 * behind this line reads inward (the stones, the gu, what the next rung asks
 * for). One muted line, because the door is not the point of the masthead.
 *
 * It renders in BOTH of the masthead's states, unplaced included: the page owns
 * the empty case and says so in its own words, which is a better answer than a
 * missing door and no way to find out why.
 */
function ApertureDoor() {
  return (
    <Link
      href="/aperture"
      className="mt-2 inline-flex items-baseline gap-1.5 text-[11px] text-muted transition-colors hover:text-amber"
    >
      <span
        aria-hidden
        lang="zh"
        className="font-[family-name:var(--font-zh)] text-(--essence)"
      >
        竅
      </span>
      aperture →
    </Link>
  );
}

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
        <p className="text-xs text-muted">unplaced — run aperture-sync</p>
        <ApertureDoor />
      </div>
    );
  }

  const { ago, stale } = freshness(glance);
  const essence = essenceOf(glance.rank, glance.stage);
  const essenceText = essenceTextClass(essence);
  const swatch = essenceSwatchClass(essence);
  const glyphs = stageGlyphs(glance.rank, glance.stage);
  const numeral = displayNumeral(glance.rank);
  const family = familyOf(glance.rank);

  return (
    <div className="relative px-4 pb-2 pt-4">
      {/* the skin's corner signature — one small cinnabar stamp, always 命 */}
      <span
        aria-hidden
        lang="zh"
        className="skin-stamp absolute right-3.5 top-3.5 h-[34px] w-[34px] -rotate-4 text-[19px] opacity-70"
      >
        命
      </span>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        {/* the large rank glyph — financial form, essence-inked; off the canon's
            nine there is none, for the same reason there is no swatch. */}
        {numeral && (
          <span
            aria-hidden
            lang="zh"
            className="font-[family-name:var(--font-zh)] text-[44px] leading-none text-(--essence) opacity-90"
          >
            {numeral}
          </span>
        )}
        <span className="text-[26px] font-semibold leading-none tracking-[0.06em] text-fg">
          {bandLine(glance)}
        </span>
        {glyphs && (
          <span
            lang="zh"
            className="font-[family-name:var(--font-zh)] text-sm text-muted/60"
          >
            {glyphs}
          </span>
        )}
      </div>

      {/* the brush-stroke underline — essence fading out rightward; off canon
          the essence variable is muted, so the stroke reads as neutral chrome
          rather than a colour nobody assigned. */}
      <div aria-hidden className="skin-brush mt-2.5" />

      <div
        className={`mt-2 inline-flex items-center gap-2 text-[13px] ${essenceText}`}
      >
        {swatch && (
          <span aria-hidden className={`h-[11px] w-[11px] ${swatch}`} />
        )}
        {/* the metal family, then the stage shade — Green Copper · jade green;
            immortal ranks have one name, so the family line IS the name. Off
            canon: the literal stage, muted. */}
        {essence
          ? family
            ? `${family.en} · ${essence.toLowerCase()}`
            : essence
          : glance.stage}
        {family && (
          <span
            lang="zh"
            className="font-[family-name:var(--font-zh)] text-xs text-muted/60"
          >
            {family.zh}
          </span>
        )}
      </div>

      {/* the breakthrough flourish — a client island under the essence line it
          reads in the register of, silent on every load but the first after a
          rank or stage moved (roadmap 70a) */}
      <BreakthroughMoment rank={glance.rank} stage={glance.stage} />

      {/* An unparseable seal reads no age and lights no dot — so there is no meta
          line at all rather than an empty one. */}
      <div
        className={`flex flex-wrap items-baseline gap-x-3.5 gap-y-1 text-[11px] text-muted ${ago || stale ? "mt-1.5" : ""}`}
      >
        {ago && <span className="tabular-nums">{ago}</span>}
        {stale && (
          // A dot, never a colour: a stale seal is the owner's own lateness, not an
          // error, so it whispers and explains itself on hover.
          <span className="inline-flex items-baseline gap-1.5">
            <span
              aria-hidden
              title="seal stale — the weekly ritual is overdue"
              className="inline-block h-[7px] w-[7px] rounded-full bg-muted"
            />
            <span className="text-muted/60">seal stale</span>
          </span>
        )}
      </div>

      <ApertureDoor />
    </div>
  );
}
