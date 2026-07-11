import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * finstore — the guarded R2 I/O layer for the E2EE financial layer (ADR 0054,
 * storage on R2 since ADR 0060, holdings folded into the envelope by ADR 0061).
 * Kept apart from `inbox.ts`, which is scoped to the `inbox/` files paths; this
 * module owns the `meta/fin` + `meta/snap/index.json` keys in the same private
 * bucket and speaks only to the crypto/route/cron plumbing.
 *
 * Like every connector (ADR 0003) it degrades rather than throws: no `R2_*` env
 * (local dev, CI) → the store is off, reads report "error", and mutating calls
 * no-op.
 *
 * Two paths, two shapes of opacity:
 *   - `meta/fin` — the AEV1 config envelope, raw ciphertext bytes the server never
 *     parses (`getFinConfig`/`putFinConfig` move `Uint8Array`).
 *   - `meta/snap/index.json` — the plaintext reading index the cron read-modify-writes.
 *
 * The three-state reads and no-clobber first-run writes live in `r2.readKey` /
 * `r2.writeKey`; the distinction stays load-bearing here — the cron's
 * read-modify-write of the index would rebuild empty (clobbering ~400 days of
 * history) if an "error" ever read as "absent", and a first-run misread would
 * orphan the sealed config. This module only binds the fixed paths to those
 * contracts. (The `meta/snapkey` + `meta/snap/*.bin` sealed-box paths retired
 * with ADR 0061 — net-worth history now reconstructs client-side from the
 * envelope's step functions.)
 */

export const FIN_PATH = "meta/fin";
export const SNAP_INDEX_PATH = "meta/snap/index.json";

/** A bare Sydney calendar day, `YYYY-MM-DD`. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type { StoreRead, StoreWrite };

/**
 * Read the raw config envelope bytes. "absent" (a healthy read found none — first
 * run, before setup writes a fresh key) stays strictly apart from "error": setup
 * keys off absence, so mistaking a flaky fetch for it would orphan every sealed box.
 */
export function getFinConfig(): Promise<StoreRead<Uint8Array>> {
  return readKey(FIN_PATH);
}

/**
 * Write the config envelope at its fixed path. `overwrite` is false for first-run
 * setup (which mints a fresh master key), so a client that misread a flaky fetch as
 * "no config yet" physically cannot clobber an existing envelope — the conditional
 * put refuses and reports "conflict". Only moves bytes; the caller validates.
 */
export function putFinConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(FIN_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}

/**
 * Read the raw reading-index JSON. The three-state IS THE POINT here: the cron does a
 * read-modify-write of this index, so an "error" (store off / bad status / threw)
 * misread as "absent" would rebuild it from empty and clobber ~400 days of history.
 * "absent" is only ever a genuine first-run empty store.
 */
export async function getSnapIndex(): Promise<StoreRead<string>> {
  const read = await readKey(SNAP_INDEX_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/**
 * Overwrite the reading index (there is a single writer — the nightly cron — so no
 * conflict handling is needed). `true` on success, `false` when the store is off or
 * the write fails; never surfaces the error.
 */
export async function putSnapIndex(json: string): Promise<boolean> {
  const wrote = await writeKey(SNAP_INDEX_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
