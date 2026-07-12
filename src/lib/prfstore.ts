import { readKey, writeKey, type StoreRead } from "./r2";
import { isPrfWrapSet, type PrfWrapSet } from "./prf";

/**
 * prfstore — guarded R2 I/O for the passkey PRF wrap set (ADR: PRF unlock), a
 * SIBLING of the passphrase keystore at `meta/prfwrap`. The finstore/webauthn
 * store pattern verbatim: no `R2_*` env (local dev, CI) → reads report "error"
 * and mutating calls no-op, so the passkey-unlock affordance simply doesn't
 * function rather than crashing a page.
 *
 * Three-state reads stay load-bearing: "absent" is a healthy miss (no device has
 * enrolled a PRF wrap yet) and must never blur into "error" — the passphrase is
 * the always-present fallback, so a flaky read misread as "no wraps" would just
 * drop a working passkey unlock, never orphan the vault. A single owner
 * read-modify-writes the whole set, so `putPrfWrapSet` overwrites unconditionally.
 */

export const PRF_WRAP_PATH = "meta/prfwrap";
/** Generous cap: 12 wraps × the guard's field maxima, plus JSON overhead. */
export const PRF_WRAP_MAX_BYTES = 16384;

/**
 * Read the wrap set, three-state. "ok" only for a healthy read that parses AND
 * passes the shape guard; malformed bytes read as "error" (never "absent"), so a
 * corrupt object can't masquerade as a first run and lure a fresh empty write.
 */
export async function getPrfWrapSet(): Promise<StoreRead<PrfWrapSet>> {
  const read = await readKey(PRF_WRAP_PATH);
  if (read.state !== "ok") return read;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
    if (!isPrfWrapSet(parsed)) return { state: "error" };
    return { state: "ok", value: parsed };
  } catch {
    return { state: "error" };
  }
}

/**
 * Overwrite the wrap set at its fixed path. There is a single writer (the owner,
 * doing a read-modify-write of the whole set to add or revoke a device), so no
 * conflict handling is needed. `true` on success, `false` when the store is off
 * or the write fails; never surfaces the error.
 */
export async function putPrfWrapSet(set: PrfWrapSet): Promise<boolean> {
  const wrote = await writeKey(PRF_WRAP_PATH, JSON.stringify(set), {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
