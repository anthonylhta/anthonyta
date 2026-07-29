/**
 * AEV2 context strings — the storage path each MK-sealed config blob binds to as
 * its AAD (ADR 0073). Threading these is what upgrades a store from AEV1 (integrity
 * of bytes) to AEV2 (integrity of bytes AT THIS ADDRESS): a compromised store can no
 * longer substitute one valid blob for another under the same key without the open
 * failing.
 *
 * ONE source of truth so a seal site and an open site can never drift — a mismatch
 * would make the blob unreadable on its next write. Each constant equals the R2 key
 * its `lib/*store` module already uses (`aevcontext.test.ts` pins them equal); this
 * module is deliberately dependency-free so it imports cleanly into client
 * components and the crypto worker without pulling in any server/store code.
 *
 * Backward-compatible by construction: `open` ignores the context for an existing
 * AEV1 envelope (dispatches on the magic), so threading a context breaks nothing at
 * rest — only the store's NEXT write becomes AEV2, and every reader here passes the
 * same context so it reads back. Migration is lazy, no flag day.
 *
 * Only the fixed single-blob config stores live here. The larger call sites named in
 * ADR 0073 — inbox (keyed per blob), vault (sealed by the vault-sync script), and the
 * dropbox key's sealed private half — thread their own paths as a follow-up.
 */

export const FIN_CONTEXT = "meta/fin";
export const TRANSIT_CONTEXT = "meta/transit";
export const TODO_CONTEXT = "meta/todo";
export const TOTP_CONTEXT = "meta/totp";
export const GYM_CONTEXT = "meta/gym";
/** The MK-rotation journal (ADR 0090/0103) — AEV2 from birth; no AEV1 legacy. */
export const ROTATION_CONTEXT = "meta/rotation";
/** The aperture status envelope — AEV2 from birth; its single writer is the
 *  owner-run sync script, so no store module pins this one yet. */
export const APERTURE_CONTEXT = "meta/aperture";

/**
 * The aperture seal history — one envelope per SEAL, at a dated key the sync
 * script archives before each overwrite of `meta/aperture`. The first path
 * FAMILY in this module: there is no shared context constant, because each
 * dated envelope binds ITS OWN full key as AAD. That per-key binding is the
 * doctrine taken to where it points — two seals in the same family cannot be
 * swapped for each other any more than two stores can.
 */
export const APERTURE_HIST_PREFIX = "meta/aperture-hist/";

/** A calendar day as the dated keys spell it. Shape only — the writers derive
 *  real days, and a key that merely LOOKS dated still refuses to classify. */
const HIST_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The dated key (= AAD context) for one archived seal. */
export function apertureHistPath(day: string): string {
  return `${APERTURE_HIST_PREFIX}${day}.bin`;
}

/**
 * The day a history key archives, or null when the key is not a well-formed
 * member of the family. Strict on purpose: the rotation classifier refuses the
 * whole estate over a key this returns null for, exactly as it does for a
 * malformed vault path.
 */
export function apertureHistDay(key: string): string | null {
  if (!key.startsWith(APERTURE_HIST_PREFIX) || !key.endsWith(".bin"))
    return null;
  const day = key.slice(APERTURE_HIST_PREFIX.length, -".bin".length);
  return HIST_DAY_RE.test(day) ? day : null;
}
