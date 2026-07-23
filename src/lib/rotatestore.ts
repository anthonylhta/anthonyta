import { r2Delete, r2Enabled, r2List, readKey, writeKey } from "./r2";
import type { StoreRead, StoreWrite } from "./r2";
import { ROTATION_PATH } from "./rotationset";

/**
 * rotatestore — the guarded R2 I/O layer for the master-key-rotation journal
 * (ADR 0090, wiring per ADR 0103) plus the estate listing the walk classifies.
 * Sibling to finstore: it owns the `meta/rotation` key, speaks only to the
 * /api/rotation plumbing, and degrades rather than throws (no `R2_*` env →
 * reads report "error", mutations no-op).
 *
 * The journal is one more opaque envelope to the server (AEV2, context-bound to
 * its own path — sealed under the NEW master key, so it dies with a rotation
 * rather than outliving one). The three-state read + no-clobber first write are
 * load-bearing exactly as they are for the keystore: "absent" starts a fresh
 * rotation, so a flaky read misreported as absent could lure a second journal
 * over a live one — the conditional first write refuses instead.
 */

export type { StoreRead, StoreWrite };

/** One estate entry: the key plus its size (progress UI); the server already
 *  sees both — listing adds no metadata the bucket didn't have. */
export interface EstateEntry {
  key: string;
  size: number;
}

/** Read the raw journal envelope bytes (three-state). */
export function getRotation(): Promise<StoreRead<Uint8Array>> {
  return readKey(ROTATION_PATH);
}

/** Write the journal envelope. `overwrite` false = rotation start (no-clobber,
 *  conflict → 409 upstream); true = every progress update thereafter. */
export function putRotation(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(ROTATION_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}

/** Delete the journal (rotation complete). Idempotent — deleting an absent
 *  journal is success, not failure. False only when the store is off/broken. */
export async function deleteRotation(): Promise<boolean> {
  if (!r2Enabled()) return false;
  try {
    const res = await r2Delete(ROTATION_PATH);
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** The prefixes that ARE the estate — everything the hub stores. The classifier
 *  (rotationset) must see the complete picture to fail closed; omitting a
 *  prefix here would hide its keys from the unknown-check entirely. */
const ESTATE_PREFIXES = [
  "meta/",
  "inbox/",
  "vault/",
  "share/",
  "dropbox/",
] as const;

/**
 * List every key in the estate (paginated to exhaustion, all prefixes). `null`
 * on a store that is off or any listing failure — the caller must treat that as
 * "cannot know the estate", never as "empty estate": a rotation planned over a
 * partial listing would leave the unlisted blobs sealed under the retiring key.
 */
export async function listEstate(): Promise<EstateEntry[] | null> {
  if (!r2Enabled()) return null;
  try {
    const entries: EstateEntry[] = [];
    for (const prefix of ESTATE_PREFIXES) {
      let token: string | undefined;
      do {
        const page = await r2List(prefix, token);
        for (const o of page.objects)
          entries.push({ key: o.key, size: o.size });
        token = page.next;
      } while (token !== undefined);
    }
    return entries;
  } catch {
    return null;
  }
}
