import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * jobsstore — R2 I/O for the E2EE application-ledger envelope. One fixed path,
 * raw ciphertext both ways — the server never parses it, exactly like
 * `meta/fin` / `meta/gym` / `meta/meals`. The three-state read and no-clobber
 * first write stay load-bearing: a flaky read misreported as "absent" must
 * never lure the client into re-seeding an empty ledger over the search's
 * history.
 */

export const JOBS_PATH = "meta/jobs";

export type { StoreRead, StoreWrite };

/** Read the raw envelope bytes; absent only on a healthy first run. */
export function getJobsConfig(): Promise<StoreRead<Uint8Array>> {
  return readKey(JOBS_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing ledger ("conflict"). */
export function putJobsConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(JOBS_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
