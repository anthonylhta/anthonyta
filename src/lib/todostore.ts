import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * todostore — R2 I/O for the E2EE quick-capture envelope (roadmap 53). One
 * fixed path, raw ciphertext both ways — the server never parses it, exactly
 * like `meta/fin` / `meta/transit` / `meta/totp`. The three-state read and
 * no-clobber first write stay load-bearing: a flaky read misreported as
 * "absent" must never lure the client into re-seeding an empty list over the
 * owner's captures.
 */

export const TODO_PATH = "meta/todo";

export type { StoreRead, StoreWrite };

/** Read the raw envelope bytes; absent only on a healthy first run. */
export function getTodoConfig(): Promise<StoreRead<Uint8Array>> {
  return readKey(TODO_PATH);
}

/** Write the envelope. `overwrite` false on first-run setup so a misread
 *  absence physically cannot clobber an existing list ("conflict"). */
export function putTodoConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(TODO_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
