import { readKey, writeKey, type StoreRead, type StoreWrite } from "./r2";

/**
 * totpstore — the guarded R2 I/O layer for the E2EE TOTP drawer (ADR: TOTP
 * drawer). One fixed path, one shape of opacity: `meta/totp` holds the AEV
 * envelope around the seed list (`TotpConfig`, lib/totp), sealed client-side
 * under the master key. The server moves raw bytes and never parses them —
 * the seeds are the crown jewels of 2FA (whoever holds them mints valid codes
 * forever), so they get the exact `meta/fin` treatment.
 *
 * Like every store module it degrades rather than throws: no `R2_*` env →
 * reads report "error" and writes report "failed".
 */

export const TOTP_PATH = "meta/totp";

/** Far above any real seed list (each entry is ~200 bytes; this allows ~300). */
export const TOTP_MAX_BYTES = 64 * 1024;

/**
 * Read the raw envelope bytes. "absent" (a healthy read found none — the drawer
 * is empty/unarmed) stays strictly apart from "error": a flaky read answering
 * "absent" would offer a first-write that clobbers the real seed list.
 */
export function getTotpConfig(): Promise<StoreRead<Uint8Array>> {
  return readKey(TOTP_PATH);
}

/**
 * Write the envelope at its fixed path. `overwrite` is false for the first
 * write, so a client that misread a flaky fetch as "no seeds yet" physically
 * cannot clobber the existing list — the conditional put refuses ("conflict").
 * Only moves bytes; the caller validates.
 */
export function putTotpConfig(
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(TOTP_PATH, bytes, {
    overwrite,
    contentType: "application/octet-stream",
  });
}
