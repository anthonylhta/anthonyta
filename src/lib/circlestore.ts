import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * circlestore — R2 I/O for the E2EE circle envelope (the platform band). One
 * fixed path, raw ciphertext both ways — the server never parses it, exactly
 * like `meta/gu-marks`. The record is the owner's own word, written from
 * /aperture the moment a bar is spoken or kept; the check-in folds it into the
 * seal, and the sync script never reads this store. The three-state read and
 * the no-clobber first write stay load-bearing: a flaky read misreported as
 * "absent" must never lure the client into re-seeding an empty record over a
 * standing bar.
 */

export const CIRCLE_PATH = "meta/circle";

export type { StoreRead, StoreWrite };

/** Read the raw envelope bytes; absent only on a healthy first run. */
export function getCircle(): Promise<StoreRead<Uint8Array>> {
  return readKey(CIRCLE_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing record ("conflict"). */
export function putCircle(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(CIRCLE_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
