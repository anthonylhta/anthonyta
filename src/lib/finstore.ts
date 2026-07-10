import { get, list, put } from "@vercel/blob";
import { sydneyDaysAgo } from "./fin";
import { toB64url } from "./crypto";

/**
 * finstore — the guarded Vercel Blob I/O layer for the E2EE financial layer (ADR:
 * sealed net worth). Kept apart from `inbox.ts`, which is scoped to the `inbox/`
 * files store; this module owns the `meta/fin*` + `meta/snap*` paths in that same
 * private store and speaks only to the crypto/route/cron plumbing.
 *
 * Like every connector (ADR 0003) it degrades rather than throws: no
 * `BLOB_READ_WRITE_TOKEN` (local dev, CI) → the store is off, reads report "error",
 * and mutating calls no-op. The SDK reads the token straight off `process.env`, so
 * `blobEnabled()` only confirms it's present.
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
 * Reads are three-state — "ok"/"absent"/"error" — because the distinction is
 * load-bearing: the cron does a read-modify-write of the reading index, so an "error"
 * misread as "absent" would rebuild an empty index and clobber ~400 days of history
 * (and, for `meta/fin`, orphan the sealed data). Writes mirror `inbox.ts` putKeystore:
 * the config/snapkey puts refuse to overwrite on first-run and re-check existence to
 * report "conflict" instead of silently winning a race; the single-writer index and
 * snapshot boxes always overwrite.
 */

export const FIN_PATH = "meta/fin";
export const SNAPKEY_PATH = "meta/snapkey";
export const SNAP_PREFIX = "meta/snap/";
export const SNAP_INDEX_PATH = "meta/snap/index.json";

/** A single dated snapshot pathname: the index.json living under the same prefix never matches. */
const SNAP_BOX_RE = /^meta\/snap\/\d{4}-\d{2}-\d{2}\.bin$/;
/** A bare Sydney calendar day, `YYYY-MM-DD`. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type StoreRead<T> =
  | { state: "ok"; value: T }
  | { state: "absent" }
  | { state: "error" };
export type StoreWrite = "ok" | "conflict" | "failed";

/** The Blob store is only reachable when a read-write token is configured; the SDK
 *  reads the token itself, so presence is all we check. */
export function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Read the raw config envelope bytes. "absent" (a healthy read found none — first run,
 * before setup writes a fresh key) is kept strictly apart from "error" (store off /
 * bad status / read threw): setup keys off absence, so mistaking a flaky fetch for it
 * would orphan every sealed box. The `get` result carries content as a stream, drained
 * through a `Response` to bytes.
 */
export async function getFinConfig(): Promise<StoreRead<Uint8Array>> {
  if (!blobEnabled()) return { state: "error" };
  try {
    const res = await get(FIN_PATH, { access: "private" });
    if (!res) return { state: "absent" };
    if (res.statusCode !== 200) return { state: "error" };
    const buf = await new Response(res.stream).arrayBuffer();
    return { state: "ok", value: new Uint8Array(buf) };
  } catch (err) {
    console.error("[finstore] fin read failed:", err);
    return { state: "error" };
  }
}

/**
 * Write the config envelope at its fixed path. `overwrite` is false for first-run
 * setup (which mints a fresh master key), so a client that misread a flaky fetch as
 * "no config yet" physically cannot clobber an existing envelope — the put refuses and
 * the existence re-check reports "conflict". Only moves bytes; the caller validates.
 */
export async function putFinConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  if (!blobEnabled()) return "failed";
  try {
    await put(FIN_PATH, new Blob([bytes as BlobPart]), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: overwrite,
      contentType: "application/octet-stream",
    });
    return "ok";
  } catch (err) {
    if (!overwrite && (await getFinConfig()).state === "ok") return "conflict";
    console.error("[finstore] fin write failed:", err);
    return "failed";
  }
}

/**
 * Read the raw snapkey JSON (public box key + MK-sealed private half). Server-readable,
 * but this layer only moves the string — the route/cron validate the shape. Same
 * three-state contract as the config: "absent" means first run, "error" means don't
 * touch it.
 */
export async function getSnapkey(): Promise<StoreRead<string>> {
  if (!blobEnabled()) return { state: "error" };
  try {
    const res = await get(SNAPKEY_PATH, { access: "private" });
    if (!res) return { state: "absent" };
    if (res.statusCode !== 200) return { state: "error" };
    return { state: "ok", value: await new Response(res.stream).text() };
  } catch (err) {
    console.error("[finstore] snapkey read failed:", err);
    return { state: "error" };
  }
}

/**
 * Write the snapkey JSON at its fixed path. Mirrors `putFinConfig`: first-run setup
 * writes with `overwrite` false so a misread can't clobber the sealed private half,
 * and the throw path re-checks existence to report "conflict". The caller validates.
 */
export async function putSnapkey(
  json: string,
  overwrite: boolean,
): Promise<StoreWrite> {
  if (!blobEnabled()) return "failed";
  try {
    await put(SNAPKEY_PATH, json, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: overwrite,
      contentType: "application/json",
    });
    return "ok";
  } catch (err) {
    if (!overwrite && (await getSnapkey()).state === "ok") return "conflict";
    console.error("[finstore] snapkey write failed:", err);
    return "failed";
  }
}

/**
 * Read the raw reading-index JSON. The three-state IS THE POINT here: the cron does a
 * read-modify-write of this index, so an "error" (store off / bad status / threw)
 * misread as "absent" would rebuild it from empty and clobber ~400 days of history.
 * "absent" is only ever a genuine first-run empty store.
 */
export async function getSnapIndex(): Promise<StoreRead<string>> {
  if (!blobEnabled()) return { state: "error" };
  try {
    const res = await get(SNAP_INDEX_PATH, { access: "private" });
    if (!res) return { state: "absent" };
    if (res.statusCode !== 200) return { state: "error" };
    return { state: "ok", value: await new Response(res.stream).text() };
  } catch (err) {
    console.error("[finstore] index read failed:", err);
    return { state: "error" };
  }
}

/**
 * Overwrite the reading index (there is a single writer — the nightly cron — so no
 * conflict handling is needed). `true` on success, `false` when the store is off or
 * the write throws; never surfaces the error.
 */
export async function putSnapIndex(json: string): Promise<boolean> {
  if (!blobEnabled()) return false;
  try {
    await put(SNAP_INDEX_PATH, json, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return true;
  } catch (err) {
    console.error("[finstore] index write failed:", err);
    return false;
  }
}

/**
 * Write one day's sealed box at `meta/snap/<date>.bin`, always overwriting so a cron
 * rerun is idempotent. `false` when the store is off, `date` isn't a `YYYY-MM-DD` (so
 * a malformed date can never forge a stray pathname), or the write throws.
 */
export async function writeSnapBox(
  date: string,
  box: Uint8Array,
): Promise<boolean> {
  if (!blobEnabled() || !DATE_RE.test(date)) return false;
  try {
    await put(`${SNAP_PREFIX}${date}.bin`, new Blob([box as BlobPart]), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/octet-stream",
    });
    return true;
  } catch (err) {
    console.error("[finstore] snapshot write failed:", date, err);
    return false;
  }
}

/** The `YYYY-MM-DD` day of a box pathname that already matched `SNAP_BOX_RE`
 *  (strip the `meta/snap/` prefix and the `.bin` suffix). */
function boxDate(pathname: string): string {
  return pathname.slice(SNAP_PREFIX.length, -4);
}

/**
 * The last `days` days of sealed boxes as base64url, newest window only. Lists the
 * whole `meta/snap/` prefix (paginating on the cursor), keeps only real box pathnames
 * (index.json is filtered out) whose date is >= today minus `days` by lexicographic
 * compare, then fetches each in parallel and drains its stream to bytes. A single
 * failed/missing box is logged and skipped — only a failed LIST fails the whole call,
 * since a partial series still renders while a bad list would silently look empty.
 */
export async function readSnapshots(
  days: number,
): Promise<
  | { state: "ok"; days: { date: string; box_b64: string }[] }
  | { state: "error" }
> {
  if (!blobEnabled()) return { state: "error" };

  const pathnames: string[] = [];
  try {
    let cursor: string | undefined;
    do {
      const res = await list({ prefix: SNAP_PREFIX, cursor });
      for (const b of res.blobs) pathnames.push(b.pathname);
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error("[finstore] snapshot list failed:", err);
    return { state: "error" };
  }

  const cutoff = sydneyDaysAgo(days);
  const wanted = pathnames.filter(
    (p) => SNAP_BOX_RE.test(p) && boxDate(p) >= cutoff,
  );

  const boxes = await Promise.all(
    wanted.map(async (pathname) => {
      const date = boxDate(pathname);
      try {
        const res = await get(pathname, { access: "private" });
        if (!res || res.statusCode !== 200) {
          console.error("[finstore] snapshot read missing:", pathname);
          return null;
        }
        const buf = await new Response(res.stream).arrayBuffer();
        return { date, box_b64: toB64url(new Uint8Array(buf)) };
      } catch (err) {
        console.error("[finstore] snapshot read failed:", pathname, err);
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
