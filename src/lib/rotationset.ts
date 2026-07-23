/**
 * rotationset — the fail-closed classifier that decides, for every key in the R2
 * estate, what a master-key rotation must do with it (ADR 0090's walk, planned in
 * ADR 0103). Pure data transforms only (no store, no `next` import, no WebCrypto),
 * so it runs unchanged in the window, a worker, and Node-vitest.
 *
 * THE invariant this module exists for: the walk's blob listing cannot be a
 * hand-maintained list, because CI cannot validate a hand-list against the live
 * bucket — a future MK-sealed store missed by the list would sail through the
 * rotation un-rewritten and be orphaned at promotion. So the classifier inverts
 * the burden: every key the live listing surfaces must classify as `rewrite` or
 * `skip` (each with an explicit, recorded reason), and anything unrecognized is
 * `unknown` — which REFUSES the rotation. A new store added without updating this
 * module blocks loudly at the start instead of losing data silently at the end.
 *
 * Path constants are imported from their owning pure modules where possible; the
 * few that live in server-only store modules are literals here, pinned equal by
 * `rotationset.test.ts` (the aevcontext drift-guard pattern). For non-exported
 * prefixes a drifted path simply stops matching and classifies `unknown` — the
 * refusal IS the drift guard.
 */

import {
  FIN_CONTEXT,
  ROTATION_CONTEXT,
  TODO_CONTEXT,
  TOTP_CONTEXT,
  TRANSIT_CONTEXT,
} from "./aevcontext";
import { DROPBOX_KEY_PATH, DROPBOX_PREFIX } from "./dropbox";
import {
  INBOX_PREFIX,
  isEncrypted,
  isValidPathname,
  SHARE_PREFIX,
} from "./files";
import {
  isValidVaultPath,
  VAULT_MANIFEST_PATH,
  VAULT_PREFIX,
} from "./vaultblob";

/** The rotation journal's fixed R2 key — DEFINED as its AEV2 context (a store
 *  born AEV2 has no reason to let path and AAD drift; equality is by
 *  construction, not by test pin). */
export const ROTATION_PATH = ROTATION_CONTEXT;

/** Size cap for the sealed journal envelope: two path arrays over a ~700-blob
 *  estate is ~50KB of JSON — 256KB leaves generous headroom without admitting
 *  anything blob-sized. */
export const ROTATION_MAX_BYTES = 262_144;

/**
 * What the walk does with one key:
 *  - `rewrite`/`envelope`  — open under MK1, re-seal under MK2, overwrite in
 *    place. `context` is the AAD path for the fixed AEV2 config stores
 *    (ADR 0099); absent = re-seal as AEV1, preserving exactly the format the
 *    blob's readers expect today (upgrading vault/inbox to AEV2 stays the
 *    separate follow-up named in ADR 0099 — a rotation must never change what a
 *    reader can open).
 *  - `rewrite`/`dropboxkey` — the record's MK-sealed `sealed_priv_b64` sub-field
 *    is re-sealed; the plaintext `pub_b64` MUST ride through byte-identical
 *    (strangers encrypt to it — ADR 0062).
 *  - `rewrite`/`manifest`  — not decrypt-reencrypt: the walk re-BUILDS it from
 *    the envelope hashes it collects while rewriting `vault/*`, and writes it
 *    LAST (ADR 0086 — its entries hash the served envelope bytes, so every
 *    vault rewrite stales it).
 *  - `skip` — proven not-MK-sealed (or handled by the state machine itself);
 *    the reason is recorded so the walk UI can show its work.
 *  - `unknown` — refuse the rotation.
 */
export type RotationClass =
  | { action: "rewrite"; kind: "envelope"; context?: string }
  | { action: "rewrite"; kind: "dropboxkey" }
  | { action: "rewrite"; kind: "manifest" }
  | { action: "skip"; reason: string }
  | { action: "unknown" };

/** Fixed AEV2 config stores: storage path = AAD context (ADR 0099). */
const CONTEXT_STORES: ReadonlyMap<string, string> = new Map([
  [FIN_CONTEXT, FIN_CONTEXT],
  [TRANSIT_CONTEXT, TRANSIT_CONTEXT],
  [TODO_CONTEXT, TODO_CONTEXT],
  [TOTP_CONTEXT, TOTP_CONTEXT],
]);

/** Exact `meta/*` keys the rotation deliberately leaves alone. Literals for the
 *  server-store paths are pinned by the drift-guard test. */
const META_SKIPS: ReadonlyMap<string, string> = new Map([
  [
    "meta/keystore",
    "the rotation pivot — mutated by the state machine, not walked",
  ],
  [
    "meta/prfwrap",
    "PRF KEKs need each authenticator present — dropped at promotion, re-enroll per device",
  ],
  [ROTATION_PATH, "the rotation journal itself"],
  ["meta/webauthn", "plaintext passkey credential record — no secrets"],
  ["meta/authlog", "plaintext server-written hash chain"],
  [
    "meta/layout.json",
    "plaintext layout config — the lobby layout is public anyway",
  ],
  [
    "meta/snap/index.json",
    "plaintext reading index — the deliberate E2EE boundary",
  ],
]);

/** `meta/*` prefixes that are plaintext hub state by design. */
const META_SKIP_PREFIXES: ReadonlyArray<[string, string]> = [
  ["meta/analytics/", "plaintext HLL sketches + rotating salt — no ids stored"],
  ["meta/briefing/", "plaintext briefing JSON — public market news"],
  ["meta/daily/", "plaintext daily rows (steps) — low-sensitivity by decision"],
  ["meta/chores/", "plaintext chore stamps"],
  ["meta/tft/", "plaintext LP history — public ladder data"],
  ["meta/csp/", "plaintext CSP report folds — aggregate only"],
];

/** Classify one estate key. Total: every string gets exactly one verdict. */
export function classifyKey(key: string): RotationClass {
  if (key.startsWith(VAULT_PREFIX)) {
    if (!isValidVaultPath(key)) return { action: "unknown" };
    if (key === VAULT_MANIFEST_PATH)
      return { action: "rewrite", kind: "manifest" };
    // Notes, images, the note index, the search index: MK-sealed AEV1 — exactly
    // what vault-sync seals and the /vault reader opens.
    return { action: "rewrite", kind: "envelope" };
  }

  if (key.startsWith(INBOX_PREFIX)) {
    if (!isValidPathname(key)) return { action: "unknown" };
    if (isEncrypted(key)) return { action: "rewrite", kind: "envelope" };
    return {
      action: "skip",
      reason: "legacy plaintext inbox row (pre-E2EE) — not MK-sealed",
    };
  }

  if (key.startsWith(SHARE_PREFIX))
    return {
      action: "skip",
      reason: "share envelope under a one-time fragment key — never the MK",
    };

  if (key.startsWith(DROPBOX_PREFIX))
    return {
      action: "skip",
      reason:
        "sealed box TO the dropbox keypair — survives rotation with the re-sealed key record",
    };

  if (key === DROPBOX_KEY_PATH)
    return { action: "rewrite", kind: "dropboxkey" };

  const context = CONTEXT_STORES.get(key);
  if (context !== undefined)
    return { action: "rewrite", kind: "envelope", context };

  const exact = META_SKIPS.get(key);
  if (exact !== undefined) return { action: "skip", reason: exact };

  for (const [prefix, reason] of META_SKIP_PREFIXES)
    if (key.startsWith(prefix)) return { action: "skip", reason };

  // Everything else — including the retired `meta/snapkey` / `meta/snap/*.bin`
  // sealed-box relics if they still exist (ADR 0061 left their deletion as an
  // optional chore) — refuses the rotation until a human classifies or removes
  // it. Fail closed: an unrecognized key is potential MK-sealed data.
  return { action: "unknown" };
}

/** One key's verdict, carried with the key for UI/journal use. */
export interface ClassifiedKey {
  key: string;
  verdict: RotationClass;
}

export interface EstatePartition {
  /** Keys the walk rewrites, in walk order: the integrity manifest is forced
   *  LAST (it is rebuilt from hashes collected during the other rewrites). */
  walk: string[];
  skipped: ClassifiedKey[];
  /** Non-empty = the rotation must refuse to start. */
  unknown: string[];
}

/**
 * Partition a live estate listing into the walk list, the recorded skips, and
 * the blocking unknowns. Preserves the listing's order (planRotation and the
 * walk UI both key off it) except the manifest-last rule.
 */
export function partitionEstate(keys: string[]): EstatePartition {
  const walk: string[] = [];
  let manifest: string | null = null;
  const skipped: ClassifiedKey[] = [];
  const unknown: string[] = [];
  for (const key of keys) {
    const verdict = classifyKey(key);
    if (verdict.action === "rewrite") {
      if (verdict.kind === "manifest") manifest = key;
      else walk.push(key);
    } else if (verdict.action === "skip") skipped.push({ key, verdict });
    else unknown.push(key);
  }
  if (manifest !== null) walk.push(manifest);
  return { walk, skipped, unknown };
}
