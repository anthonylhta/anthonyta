import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * mealsstore — R2 I/O for the E2EE meal-log envelope. One fixed path, raw
 * ciphertext both ways — the server never parses it, exactly like `meta/fin` /
 * `meta/transit` / `meta/todo` / `meta/totp` / `meta/gym`. The three-state read
 * and no-clobber first write stay load-bearing: a flaky read misreported as
 * "absent" must never lure the client into re-seeding an empty log over the
 * owner's food library.
 */

export const MEALS_PATH = "meta/meals";

export type { StoreRead, StoreWrite };

/** Read the raw envelope bytes; absent only on a healthy first run. */
export function getMealsConfig(): Promise<StoreRead<Uint8Array>> {
  return readKey(MEALS_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing log ("conflict"). */
export function putMealsConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(MEALS_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
