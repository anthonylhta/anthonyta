import { createHash, timingSafeEqual } from "node:crypto";
import {
  r2Enabled,
  readKey,
  writeKey,
  type StoreRead,
  type StoreWrite,
} from "@/lib/r2";
import { WEBAUTHN_PATH } from "./record";

/**
 * Guarded R2 I/O for the passkey credential record — `meta/webauthn` in the same
 * private bucket, the getSnapkey/putSnapkey pattern verbatim. Degrades rather
 * than throws: no `R2_*` env → reads report "error" and the door simply can't
 * authenticate; it never crashes a page.
 *
 * Three-state reads are load-bearing here too: "absent" is what arms the
 * bootstrap paths (first enrollment mints the recovery code; the break-glass
 * flag only honors a strictly-absent record), so an "error" misread as "absent"
 * could invite a second first-enrollment. Enrollment and counter updates
 * read-modify-write this record across requests; R2's S3 endpoint serves reads
 * directly from the bucket (no CDN cache to go stale, unlike the old Blob store's
 * `useCache: false` workaround).
 */
export function webauthnStoreEnabled(): boolean {
  return r2Enabled();
}

/**
 * Break-glass bootstrap gate: sessionless first enrollment. Safe by
 * construction, not by runbook — an open window is useless without the secret,
 * so a racing attacker can't beat the owner to the first enrollment even while
 * the window is open. Three conditions, all required:
 *  - `WEBAUTHN_BOOTSTRAP` is set to a high-entropy secret (a deliberate Vercel
 *    env change + redeploy by the owner);
 *  - the caller presents that exact secret (constant-time compare — the boolean
 *    flag alone never sufficed, since the server couldn't tell the owner's
 *    ceremony from an attacker's);
 *  - the record is strictly absent — a healthy read that found nothing (an
 *    errored read never qualifies: a store hiccup must not open a window over an
 *    existing record).
 * Distinct from `WEBAUTHN_RECOVERY` (which redeems an existing hash); bootstrap
 * seeds an absent record, so the two are mutually exclusive by definition.
 */
export async function bootstrapOpen(token: string | null): Promise<boolean> {
  const secret = process.env.WEBAUTHN_BOOTSTRAP ?? "";
  if (secret.length === 0 || typeof token !== "string" || token.length === 0)
    return false;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!timingSafeEqual(a, b)) return false;
  return (await getWebauthnRecord()).state === "absent";
}

export async function getWebauthnRecord(): Promise<StoreRead<string>> {
  const read = await readKey(WEBAUTHN_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/**
 * Write the record at its fixed path. First enrollment writes with `overwrite`
 * false so a raced or replayed bootstrap physically cannot clobber an existing
 * record (the conditional put refuses and reports "conflict"); routine
 * mutations — appending a credential, advancing a counter, consuming the
 * recovery code — pass true. The caller validates the shape; this moves bytes.
 */
export function putWebauthnRecord(
  json: string,
  overwrite: boolean,
): Promise<StoreWrite> {
  return writeKey(WEBAUTHN_PATH, json, {
    overwrite,
    contentType: "application/json",
  });
}
