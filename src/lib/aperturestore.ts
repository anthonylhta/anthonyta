import { readKey, type StoreRead } from "./r2";

/**
 * aperturestore — the guarded R2 I/O for the private status module (lib/aperture).
 * READ-ONLY on purpose: the sealed blob and its glance have a SINGLE writer, the
 * owner-run sync script that adjudicates off-site and lands its result already
 * settled. Nothing the site serves ever writes here, so there is no put, no
 * read-modify-write, and no conflict dance to get wrong — the whole risk surface
 * this module usually carries simply isn't here.
 *
 * Like every connector (ADR 0003) it degrades rather than throws: no `R2_*` env
 * (local dev, CI) → the store is off and both reads report "error".
 *
 * Two paths, two shapes of opacity — finstore's precedent (`meta/fin` ciphertext
 * beside a plaintext `meta/snap/index.json`), for the same reason:
 *   - `meta/aperture` — the AEV2 envelope, raw ciphertext bytes the server never
 *     parses; the owner's browser opens it under the master key.
 *   - `meta/aperture-glance.json` — the plaintext rank/stage glance, deliberately
 *     unsealed so the band draws before any unlock. It is the ONE part of the
 *     status the seal doesn't cover, which is why it holds nothing but rank,
 *     stage, and the seal's timestamp.
 *
 * The three-state read matters here exactly as it does everywhere else: "absent"
 * is ONLY a genuine NoSuchKey (nothing synced yet), never a flaky fetch or a
 * store that's off. The band's two empty states — "nothing to show yet" and
 * "something is wrong" — both render as silence, but a future writer keying off
 * absence would seed over the real blob if the distinction ever collapsed.
 */

export const APERTURE_PATH = "meta/aperture";
export const APERTURE_GLANCE_PATH = "meta/aperture-glance.json";

/**
 * Read the raw sealed envelope bytes, three-state. Only moves bytes: the server
 * cannot (and must never) decrypt this, so nothing here inspects the frame.
 */
export function getAperture(): Promise<StoreRead<Uint8Array>> {
  return readKey(APERTURE_PATH);
}

/**
 * Read the raw plaintext glance JSON, three-state. Decoded but not parsed — the
 * caller owns the shape (`normalizeApertureGlance`), so a malformed blob is one
 * connector's null rather than a throw crossing the store boundary.
 */
export async function getApertureGlanceRaw(): Promise<StoreRead<string>> {
  const read = await readKey(APERTURE_GLANCE_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}
