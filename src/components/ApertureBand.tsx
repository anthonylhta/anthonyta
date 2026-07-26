import { ApertureDetail } from "@/components/ApertureDetail";
import { essenceOf, isSealStale, type ApertureGlance } from "@/lib/aperture";
import {
  bandLine,
  essenceSwatchClass,
  essenceTextClass,
  sealedAgo,
} from "@/lib/apertureview";

/**
 * ApertureBand — the private status module's standing block in the TODAY zone.
 *
 * It is the ONE deliberate exception to ADR 0109's exception-only rule, and the
 * exception is the point: every other block earns its place by having something
 * wrong (a chore gone due, a project down, a message waiting) and vanishes when
 * all is well. This one has no "all is well" — the status display IS the reminder
 * surface, and a reminder that hides itself when there is nothing urgent is a
 * reminder you stop seeing. Its whole job is to stand there.
 *
 * Standing costs restraint. The rank line reads at `text-sm`, NOT the 2xl the same
 * ADR reserves for net worth: the page keeps exactly one headline figure, and a
 * block that never leaves cannot also be the loudest thing on it.
 *
 * Server-rendered from the plaintext glance (rank, stage, seal time — the only part
 * of the status that isn't sealed). Everything else lives behind the vault, in the
 * client island below.
 */

/** Both clock-dependent readings off ONE instant, so the age and the staleness dot
 *  can never disagree. Read in a helper rather than the render body the way
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

export function ApertureBand({
  glance,
  offline,
}: {
  glance: ApertureGlance | null;
  offline: boolean;
}) {
  if (!glance) {
    // No glance at all — nothing synced, or a read that failed. One muted line and
    // NO island: there is no rank to stand behind, so there is nothing to unlock
    // toward and a "sealed — unlock in files" nudge would be an invitation to open
    // a door with nothing behind it.
    return (
      <div className="border-b border-hairline px-4 py-4">
        <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
          aperture
        </div>
        <p className="text-xs text-muted">unplaced — run aperture-sync</p>
      </div>
    );
  }

  const { ago, stale } = freshness(glance);
  const essence = essenceOf(glance.rank, glance.stage);
  const essenceText = essenceTextClass(essence);
  const swatch = essenceSwatchClass(essence);

  return (
    <div className="border-b border-hairline px-4 py-4">
      <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
        aperture
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className={essenceText}>▍ {bandLine(glance)}</span>
        {swatch && (
          <span
            aria-hidden
            className={`inline-block h-2.5 w-2.5 rounded-[2px] ${swatch}`}
          />
        )}
        {/* the canon colour's name, or — off canon — the literal stage, muted */}
        <span className={essenceText}>{essence ?? glance.stage}</span>
        {ago && <span className="text-xs text-muted">{ago}</span>}
        {stale && (
          // A dot, never a colour: a stale seal is the owner's own lateness, not
          // an error, so it whispers and explains itself on hover.
          <span className="text-muted/70" title="seal stale">
            ·
          </span>
        )}
      </p>

      <ApertureDetail offline={offline} />
    </div>
  );
}
