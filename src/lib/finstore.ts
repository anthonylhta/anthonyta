import { sydneyDaysAgo } from "./fin";
import { toB64url } from "./crypto";
import {
  r2Enabled,
  r2Get,
  r2List,
  readKey,
  writeKey,
  type StoreRead,
  type StoreWrite,
} from "./r2";

/**
 * finstore — the guarded R2 I/O layer for the E2EE financial layer (ADR 0054,
 * storage on R2 since ADR 0060). Kept apart from `inbox.ts`, which is scoped to
 * the `inbox/` files paths; this module owns the `meta/fin*` + `meta/snap*` keys
 * in the same private bucket and speaks only to the crypto/route/cron plumbing.
 *
 * Like every connector (ADR 0003) it degrades rather than throws: no `R2_*` env
 * (local dev, CI) → the store is off, reads report "error", and mutating calls
 * no-op.
 *
 * Four paths, three shapes of opacity:
 *   - `meta/fin` — the AEV1 config envelope, raw ciphertext bytes the server never
 *     parses (`getFinConfig`/`putFinConfig` move `Uint8Array`).
 *   - `meta/snapkey` — server-READABLE JSON (the public box key + the MK-sealed
 *     private half); the route/cron validate its shape, this only moves the string.
 *   - `meta/snap/YYYY-MM-DD.bin` — ASB1 sealed boxes, opaque; one per day, overwritten
 *     idempotently so a cron rerun is safe.
 *   - `meta/snap/index.json` — the plaintext reading index the cron read-modify-writes.
 *
 * The three-state reads and no-clobber first-run writes live in `r2.readKey` /
 * `r2.writeKey`; the distinction stays load-bearing here — the cron's
 * read-modify-write of the index would rebuild empty (clobbering ~400 days of
 * history) if an "error" ever read as "absent", and a first-run misread would
 * orphan the sealed data. This module only binds the fixed paths to those
 * contracts.
 */

export const FIN_PATH = "meta/fin";
export const SNAPKEY_PATH = "meta/snapkey";
export const SNAP_PREFIX = "meta/snap/";
export const SNAP_INDEX_PATH = "meta/snap/index.json";

/** A single dated snapshot pathname: the index.json living under the same prefix never matches. */
const SNAP_BOX_RE = /^meta\/snap\/\d{4}-\d{2}-\d{2}\.bin$/;
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
 * Read the raw snapkey JSON (public box key + MK-sealed private half). Server-readable,
 * but this layer only moves the string — the route/cron validate the shape. Same
 * three-state contract as the config: "absent" means first run, "error" means don't
 * touch it.
 */
export async function getSnapkey(): Promise<StoreRead<string>> {
  const read = await readKey(SNAPKEY_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/**
 * Write the snapkey JSON at its fixed path. Mirrors `putFinConfig`: first-run setup
 * writes with `overwrite` false so a misread can't clobber the sealed private half.
 * The caller validates.
 */
export function putSnapkey(
  json: string,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(SNAPKEY_PATH, json, {
    overwrite,
    contentType: "application/json",
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

/**
 * Write one day's sealed box at `meta/snap/<date>.bin`, always overwriting so a cron
 * rerun is idempotent. `false` when the store is off, `date` isn't a `YYYY-MM-DD` (so
 * a malformed date can never forge a stray key), or the write fails.
 */
export async function writeSnapBox(
  date: string,
  box: Uint8Array,
): Promise<boolean> {
  if (!DATE_RE.test(date)) return false;
  const wrote = await writeKey(`${SNAP_PREFIX}${date}.bin`, box, {
    overwrite: true,
    contentType: "application/octet-stream",
  });
  return wrote === "ok";
}

/** The `YYYY-MM-DD` day of a box key that already matched `SNAP_BOX_RE`
 *  (strip the `meta/snap/` prefix and the `.bin` suffix). */
function boxDate(key: string): string {
  return key.slice(SNAP_PREFIX.length, -4);
}

/**
 * The last `days` days of sealed boxes as base64url, newest window only. Lists the
 * whole `meta/snap/` prefix (paginating on the continuation token), keeps only real
 * box keys (index.json is filtered out) whose date is >= today minus `days` by
 * lexicographic compare, then fetches each in parallel. A single failed/missing box
 * is logged and skipped — only a failed LIST fails the whole call, since a partial
 * series still renders while a bad list would silently look empty.
 */
export async function readSnapshots(
  days: number,
): Promise<
  | { state: "ok"; days: { date: string; box_b64: string }[] }
  | { state: "error" }
> {
  if (!r2Enabled()) return { state: "error" };

  const keys: string[] = [];
  try {
    let token: string | undefined;
    do {
      const page = await r2List(SNAP_PREFIX, token);
      for (const o of page.objects) keys.push(o.key);
      token = page.next;
    } while (token);
  } catch (err) {
    console.error("[finstore] snapshot list failed:", err);
    return { state: "error" };
  }

  const cutoff = sydneyDaysAgo(days);
  const wanted = keys.filter(
    (k) => SNAP_BOX_RE.test(k) && boxDate(k) >= cutoff,
  );

  const boxes = await Promise.all(
    wanted.map(async (key) => {
      const date = boxDate(key);
      try {
        const res = await r2Get(key);
        if (!res.ok) {
          console.error("[finstore] snapshot read missing:", key);
          return null;
        }
        return {
          date,
          box_b64: toB64url(new Uint8Array(await res.arrayBuffer())),
        };
      } catch (err) {
        console.error("[finstore] snapshot read failed:", key, err);
        return null;
      }
    }),
  );

  return {
    state: "ok",
    days: boxes.filter(
      (b): b is { date: string; box_b64: string } => b !== null,
    ),
  };
}
