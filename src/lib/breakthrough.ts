import { IMMORTAL_ESSENCE, MORTAL_ESSENCE, essenceOf } from "./aperture";
import { familyOf } from "./apertureview";

/**
 * breakthrough — the pure spine of the breakthrough moment (roadmap 70a). A rank
 * or a stage is the one thing on the sheet that HAPPENS rather than accrues, and
 * it lands while nobody is watching: the seal is taken at the check-in and the
 * next page load simply carries different numbers. This module holds the three
 * judgements the flourish needs — whether the pair on file is worth comparing
 * against, which colour the page is coming FROM, and how the movement reads —
 * leaving the island above it nothing but DOM and timers.
 *
 * apertureview's doctrine, applied to an animation: a pair the canon never gave a
 * colour gets NO flourish. There is no neutral sweep to fall back on, because a
 * sweep toward a colour nobody assigned would be the site inventing a fact about
 * the rank — the one thing the sheet must never do.
 */

/** Where a device remembers the rank it last saw. Plain localStorage: the memory
 *  is a display fact ("this browser has already been shown rank 2"), nothing the
 *  sheet reads for anything else and nothing worth sealing — a cleared browser
 *  just misses one flourish. */
export const SEEN_KEY = "aperture-seen-v1";

/** The rank/stage pair a device has already been shown. */
export interface SeenRank {
  rank: number;
  stage: string;
}

/** How the movement reads — `jade green → pale green` inside one metal, `Green
 *  Copper → Red Steel` across the wall between two. */
export interface BreakthroughReading {
  from: string;
  to: string;
}

/** Every name the canon assigns a colour to, both halves of it. Membership is
 *  what makes `essenceVarRef` safe to derive rather than tabulate. */
const CANON: ReadonlySet<string> = new Set([
  ...Object.values(MORTAL_ESSENCE).flatMap((stages) => Object.values(stages)),
  ...Object.values(IMMORTAL_ESSENCE),
]);

/**
 * A canon essence name → the CSS the sweep starts FROM (`var(--color-jade-green)`).
 * The same token apertureview's `ESSENCE_VAR` declares on the container, derived
 * rather than written out a fourth time; the test pins the two against each other
 * over the whole canon, so they cannot drift apart. A name outside the canon is
 * null — the island holds the sweep rather than reach for a token that may not
 * exist, which would resolve to the registered fallback and flash amber.
 */
export function essenceVarRef(name: string): string | null {
  if (!CANON.has(name)) return null;
  return `var(--color-${name.toLowerCase().replace(/\s+/g, "-")})`;
}

/**
 * The stored memory → a pair, or null for "this device has no memory". Junk reads
 * as null and never throws: the record is whatever some previous build (or a
 * devtools session) left behind, and a decoration must fail silent. Rebuilt field
 * by field like `normalizeApertureGlance`, so nothing bolted onto the record can
 * ride into the comparison.
 */
export function readSeen(raw: string | null): SeenRank | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { rank, stage } = parsed as { rank?: unknown; stage?: unknown };
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1)
    return null;
  if (typeof stage !== "string" || stage === "") return null;
  return { rank, stage };
}

/**
 * The line's two halves, or null for "say nothing". Inside one metal family the
 * reading is the SHADE, lowercase — the essence line's own register. Across
 * families it is the metal, because "black green → light red" names the step but
 * hides the wall that was crossed. Immortal ranks have no family and one essence
 * each, so on that side the essence name IS the reading.
 *
 * Null covers three refusals that are really one: a pair off the canon at either
 * end (no colour was assigned, so there is nothing to sweep between), and a
 * reading that would print the same words twice — which catches both a pair that
 * never moved and a stage that moved under an immortal rank, where the canon has
 * no stages and therefore nothing changed colour.
 */
export function breakthroughReading(
  oldRank: number,
  oldStage: string,
  newRank: number,
  newStage: string,
): BreakthroughReading | null {
  const from = essenceOf(oldRank, oldStage);
  const to = essenceOf(newRank, newStage);
  if (from === null || to === null) return null;

  const oldFamily = familyOf(oldRank);
  const newFamily = familyOf(newRank);
  const reading =
    oldFamily !== null && newFamily !== null && oldFamily.en === newFamily.en
      ? { from: from.toLowerCase(), to: to.toLowerCase() }
      : { from: oldFamily?.en ?? from, to: newFamily?.en ?? to };
  return reading.from === reading.to ? null : reading;
}
