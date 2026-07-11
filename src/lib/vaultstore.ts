import { r2Enabled, r2Get } from "./r2";
import { isValidVaultPath } from "./vaultblob";

/**
 * vaultstore — the guarded R2 I/O layer for the E2EE vault ciphertext store
 * (ADR 0059, storage on R2 since ADR 0060). Kept apart from `inbox.ts` (the
 * `inbox/` files paths) and `finstore.ts` (the `meta/fin*` financial paths); this
 * module owns only the `vault/*` ciphertext blobs the browser decrypts in place,
 * and it never parses their bytes.
 *
 * Like every connector (ADR 0003) it degrades rather than throws: no `R2_*` env
 * (local dev, CI) → the store is off and reads return null. `isValidVaultPath`'s
 * `vault/` prefix requirement structurally excludes `meta/keystore`, the inbox,
 * and traversal probes — the raw route can never exfiltrate key material.
 */

/**
 * Stream one vault blob's raw ciphertext bytes without buffering. `null` when the
 * store is off, the path is malformed (which structurally excludes `meta/*` and the
 * inbox), the blob is missing, or the read throws.
 */
export async function readVaultStream(
  p: string,
): Promise<ReadableStream | null> {
  if (!r2Enabled() || !isValidVaultPath(p)) return null;
  try {
    const res = await r2Get(p);
    if (!res.ok || !res.body) return null;
    return res.body;
  } catch (err) {
    console.error("[vault] read failed:", p, err);
    return null;
  }
}
