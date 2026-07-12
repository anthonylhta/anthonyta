import {
  DROPBOX_KEY_PATH,
  DROPBOX_PREFIX,
  isDropboxKey,
  isValidDropPath,
  type DropboxKey,
} from "./dropbox";
import {
  r2Delete,
  r2Enabled,
  r2Get,
  r2List,
  r2Put,
  readKey,
  writeKey,
  type R2ListedObject,
  type StoreRead,
  type StoreWrite,
} from "./r2";

/**
 * dropstore — the guarded R2 I/O layer for the encrypted drop box (ADR: sealed box,
 * resurrected). Like every connector (ADR 0003) it degrades rather than throws: no
 * `R2_*` env (local dev, CI) → the store is off, the key reads report "error", and
 * mutating calls no-op.
 *
 * Two shapes of opacity, mirroring finstore:
 *   - `meta/dropboxkey` — the owner's box keypair record (public point + MK-sealed
 *     private half). The three-state read is load-bearing: setup keys off "absent"
 *     to mint a FRESH keypair, so a transient failure misread as absence would
 *     orphan every message already sealed to the old public point.
 *   - `dropbox/<id>.bin` — one sealed message, opaque ciphertext the server never
 *     opens. Only the owner, behind the passphrase, can read it.
 */

/** Generous cap for the stored key record JSON (pub ≤120B + sealed priv ≤4096B + frame). */
export const DROPBOX_KEY_MAX_BYTES = 5000;

/**
 * Read the owner's box key record, three-state. "absent" (a healthy read found none —
 * the box isn't enabled yet) stays strictly apart from "error": the setup path mints a
 * fresh keypair off absence, so mistaking a flaky fetch for it would orphan sealed
 * messages. A stored blob that won't parse or fails the shape guard is "error", never
 * "absent" — the server must not treat corruption as "run first-time setup".
 */
export async function getDropboxKey(): Promise<StoreRead<DropboxKey>> {
  const read = await readKey(DROPBOX_KEY_PATH);
  if (read.state !== "ok") return read;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
    if (!isDropboxKey(parsed)) return { state: "error" };
    return { state: "ok", value: parsed };
  } catch {
    return { state: "error" };
  }
}

/**
 * Write the box key record at its fixed path. `overwrite` is false for first-run setup
 * so a client that misread a flaky fetch as "no box yet" physically cannot clobber an
 * existing keypair — the conditional put refuses and reports "conflict". The caller
 * validates the shape; the record is rebuilt from validated fields before it lands.
 */
export function putDropboxKey(
  rec: DropboxKey,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(DROPBOX_KEY_PATH, JSON.stringify(rec), {
    overwrite,
    contentType: "application/json",
  });
}

/**
 * Every sealed envelope currently under the `dropbox/` prefix. When the store is off
 * (`offline: true`) or a list throws, degrade to empty so the owner inbox can render a
 * placeholder instead of crashing — this is not a first-run-arming read, so collapsing
 * error into empty is safe here (nothing mints a key off it).
 */
export async function listDrops(): Promise<{
  objects: R2ListedObject[];
  offline: boolean;
}> {
  if (!r2Enabled()) return { objects: [], offline: true };
  try {
    const objects: R2ListedObject[] = [];
    let token: string | undefined;
    do {
      const page = await r2List(DROPBOX_PREFIX, token);
      objects.push(...page.objects);
      token = page.next;
    } while (token);
    return { objects, offline: false };
  } catch (err) {
    console.error("[dropbox] list failed:", err);
    return { objects: [], offline: true };
  }
}

/**
 * Store one sealed envelope at a `dropbox/<id>.bin` path. `false` when the store is
 * off, the path is malformed (which structurally excludes `meta/*`), or the write
 * fails — never surfaces the error. Ids are minted random by the ingest route, so
 * there is nothing to clobber and no conditional put is needed.
 */
export async function putDrop(
  path: string,
  envelope: Uint8Array,
): Promise<boolean> {
  if (!r2Enabled() || !isValidDropPath(path)) return false;
  try {
    const res = await r2Put(path, envelope, {
      contentType: "application/octet-stream",
    });
    return res.ok;
  } catch (err) {
    console.error("[dropbox] put failed:", err);
    return false;
  }
}

/**
 * Read one envelope's raw ciphertext bytes. `null` when the store is off, the path is
 * malformed, the object is missing, or the read throws — the owner inbox skips any
 * row it can't fetch rather than sinking the whole listing.
 */
export async function readDrop(path: string): Promise<Uint8Array | null> {
  if (!r2Enabled() || !isValidDropPath(path)) return null;
  try {
    const res = await r2Get(path);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error("[dropbox] read failed:", path, err);
    return null;
  }
}

/**
 * Delete one envelope by path (delete-on-read from the owner inbox). `false` when the
 * store is off, the path is malformed, or the delete fails — never surfaces the error.
 */
export async function deleteDrop(path: string): Promise<boolean> {
  if (!r2Enabled() || !isValidDropPath(path)) return false;
  try {
    const res = await r2Delete(path);
    return res.ok;
  } catch (err) {
    console.error("[dropbox] delete failed:", err);
    return false;
  }
}
