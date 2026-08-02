import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * agendastore — R2 I/O for the E2EE schedule envelope. One fixed path, raw
 * ciphertext both ways — the server never parses it, exactly like `meta/fin` /
 * `meta/transit` / `meta/todo` / `meta/totp` / `meta/gym` / `meta/meals`. The
 * three-state read and no-clobber first write stay load-bearing: a flaky read
 * misreported as "absent" must never lure the client into re-seeding an empty
 * schedule over the owner's events.
 */

export const AGENDA_PATH = "meta/agenda";

export type { StoreRead, StoreWrite };

/** Read the raw envelope bytes; absent only on a healthy first run. */
export function getAgendaConfig(): Promise<StoreRead<Uint8Array>> {
  return readKey(AGENDA_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing schedule ("conflict"). */
export function putAgendaConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(AGENDA_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
