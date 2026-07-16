import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * transitstore — the guarded R2 I/O for the E2EE saved-trips envelope (the
 * /transit page's config: home/work addresses and the trips between them,
 * sealed client-side under the vault master key). One fixed path, raw
 * ciphertext both ways — the server never parses it, exactly like `meta/fin`
 * (finstore.ts). No `R2_*` env (local dev, CI) → reads report "error" and
 * writes fail, and the page degrades to the planner-only view.
 *
 * The three-state read and no-clobber first write live in `r2.readKey` /
 * `r2.writeKey`; they stay load-bearing here for the same reason as fin's: a
 * flaky read misreported as "absent" would lure the client into re-seeding a
 * fresh (empty) config over the owner's saved trips.
 */

export const TRANSIT_PATH = "meta/transit";

export type { StoreRead, StoreWrite };

/** Read the raw config envelope bytes; absent only on a healthy first run. */
export function getTransitConfig(): Promise<StoreRead<Uint8Array>> {
  return readKey(TRANSIT_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing config ("conflict"). */
export function putTransitConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(TRANSIT_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
