import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * studystore — R2 I/O for the E2EE Japanese study log. One fixed path, raw
 * ciphertext both ways — the server never parses it, exactly like
 * `meta/circle`. The log is written from the reader's japan lane and the
 * palette's `ja` verb, and read in the browser by the check-in, the gu clocks
 * and the dao band; the sync script never reads this store. The three-state
 * read and the no-clobber first write stay load-bearing: a flaky read
 * misreported as "absent" must never lure the client into re-seeding an empty
 * log over a standing one.
 */

export const STUDY_PATH = "meta/study";

export type { StoreRead, StoreWrite };

/** Read the raw envelope bytes; absent only on a healthy first run. */
export function getStudy(): Promise<StoreRead<Uint8Array>> {
  return readKey(STUDY_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing log ("conflict"). */
export function putStudy(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(STUDY_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
