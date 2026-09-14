"use client";

import { GYM_CONTEXT, MEALS_CONTEXT } from "@/lib/aevcontext";
import { normalizeGymConfig, type GymConfig } from "@/lib/gym";
import { normalizeMealsConfig, type MealsConfig } from "@/lib/meals";

/**
 * logRiders — the two sealed logs an inward surface opens beside the document:
 * the gym log (`meta/gym`) and the meal log (`meta/meals`). Lifted out of the
 * inward page when the gu compendium wanted the same fetch → decrypt → normalize
 * walk for its feeding clocks, on the `useApertureDoc` precedent — one copy of
 * the rider doctrine, not two.
 *
 * Best-effort by construction: ANY miss (no envelope yet, a store flake, a shape
 * this build doesn't trust) returns null and the caller carries on without the
 * reading. A rider never delays or fails the page it rides.
 */
type Opener = (
  envelope: Uint8Array,
  context?: string,
) => Promise<{ bytes: Uint8Array }>;

/** The gym log, opened once — every session, newest first. */
export async function gymConfig(openItem: Opener): Promise<GymConfig | null> {
  try {
    const res = await fetch("/api/gym");
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      GYM_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeGymConfig(parsed);
  } catch {
    return null;
  }
}

/** The meal log, opened once — entries, folded days, weigh-ins. */
export async function mealsConfig(
  openItem: Opener,
): Promise<MealsConfig | null> {
  try {
    const res = await fetch("/api/meals");
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      MEALS_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeMealsConfig(parsed);
  } catch {
    return null;
  }
}
