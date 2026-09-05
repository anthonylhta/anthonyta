import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * gumarksstore — R2 I/O for the E2EE gu-book marks envelope (ADR 0175). One
 * fixed path, raw ciphertext both ways — the server never parses it, exactly
 * like `meta/jobs`. The marks are the owner's own word recorded from /gu the
 * moment it happens (refining since, cast); the check-in folds them into the
 * seal, and the sync script never reads this store. The three-state read and
 * the no-clobber first write stay load-bearing: a flaky read misreported as
 * "absent" must never lure the client into re-seeding an empty record over a
 * week's marks.
 */

export const GU_MARKS_PATH = "meta/gu-marks";

export type { StoreRead, StoreWrite };

/** Read the raw envelope bytes; absent only on a healthy first run. */
export function getGuMarks(): Promise<StoreRead<Uint8Array>> {
  return readKey(GU_MARKS_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing record ("conflict"). */
export function putGuMarks(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(GU_MARKS_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
