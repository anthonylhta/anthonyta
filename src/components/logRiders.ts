"use client";

import { GYM_CONTEXT, MEALS_CONTEXT, STUDY_CONTEXT } from "@/lib/aevcontext";
import { normalizeGymConfig, type GymConfig } from "@/lib/gym";
import { normalizeMealsConfig, type MealsConfig } from "@/lib/meals";
import { EMPTY_STUDY, normalizeStudy, type StudyConfig } from "@/lib/study";
import {
  isVaultIndex,
  VAULT_INDEX_PATH,
  type VaultIndex,
} from "@/lib/vaultblob";

/**
 * logRiders — the sealed logs an inward surface opens beside the document: the
 * gym log (`meta/gym`), the meal log (`meta/meals`), the Japanese study log
 * (`meta/study`) and the vault's note index (`vault/index`, the journal's edge). Lifted out of the
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

/** The sealed vault index, opened once — every note's title and path, which is
 *  where the journal's newest day is read from. Fetched through the owner-gated
 *  raw proxy like any `vault/*` blob; opened under the vault's own default
 *  context, not a rider context, because it IS the vault's. */
export async function vaultIndex(openItem: Opener): Promise<VaultIndex | null> {
  try {
    const res = await fetch(
      `/api/vault/raw?p=${encodeURIComponent(VAULT_INDEX_PATH)}`,
    );
    if (!res.ok) return null;
    const { bytes } = await openItem(new Uint8Array(await res.arrayBuffer()));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isVaultIndex(parsed) ? parsed : null;
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

/** The Japanese study log, opened once. A healthy 404 is a log with no
 *  sittings yet — read as empty, so the check-in counts `+0` rather than `?`. */
export async function studyConfig(
  openItem: Opener,
): Promise<StudyConfig | null> {
  try {
    const res = await fetch("/api/study");
    if (res.status === 404) return EMPTY_STUDY;
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      STUDY_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeStudy(parsed);
  } catch {
    return null;
  }
}
