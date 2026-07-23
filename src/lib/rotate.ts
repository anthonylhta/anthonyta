/**
 * Pure state machine for master-key ROTATION — minting a fresh MK, re-encrypting
 * every sealed blob under it, and retiring the old MK, WITHOUT ever creating a
 * window in which a blob is undecryptable.
 *
 * The hub's whole key hierarchy hangs off one master key (passphrase → PBKDF2 →
 * KEK → wrapped MK at `meta/keystore`; every `*.bin` sealed under the MK). A
 * passphrase change only re-wraps the SAME MK. If the MK itself is ever suspected
 * burned, the only remedy is to mint a new one and re-seal everything — and the
 * naive way to do that (swap the keystore to MK2, THEN walk the blobs) has a fatal
 * crash window: a power-loss mid-walk leaves every not-yet-rewritten blob sealed
 * under MK1, which the keystore no longer wraps → permanent data loss.
 *
 * The invariant that forbids that window: **at every instant, every blob is
 * decryptable by a key the keystore still wraps.** This module encodes the state
 * machine that upholds it as PURE DATA, so it can be exhaustively crash-tested
 * (the browser walk + R2 I/O that drive it are a follow-up). The keystore learns a
 * v3 shape that holds TWO wraps — the everyday primary plus a `pending` wrap of the
 * new MK — for the whole rotation; the old wrap is dropped (promotion) ONLY after a
 * full verify pass proves every blob opens under MK2. A sealed `RotationJournal`
 * records progress so any device can crash and resume from exactly where it left
 * off, and refuses to trample a rotation another device started.
 *
 * No store, no `next` import, no WebCrypto — this layer is data transforms only,
 * so it runs unchanged in the window, a worker, and Node-vitest, and is
 * unit-testable on its own (mirrors lib/merkle + lib/authlog, minus the hashing).
 * The one import is `crypto.ts`'s keystore shape + guard — pure data checks from
 * a module that is itself side-effect-free.
 */

import { isKeystore, type Keystore } from "./crypto";

// ---------------------------------------------------------------------------
// keystore v3 — the two-wrap, rotation-era keystore shape
// ---------------------------------------------------------------------------

/**
 * The keystore's rotation-era shape. v3 carries the everyday primary wrap
 * (`wrapped_mk_b64` — the OLD MK for the duration of a rotation, MK2 after
 * promotion) plus, ONLY during a rotation, a `pending` wrap of the NEW master key
 * under the SAME KEK — so a single passphrase unlocks either MK while the walk is
 * in flight. Outside a rotation `pending` is absent and v3 is structurally a v2
 * with a bumped version.
 *
 * The shape itself now lives in `crypto.ts`'s `Keystore` union (both kdfs, the
 * per-version field rules) so there is exactly ONE guard for every acceptance
 * point — the server PUT gate, the client parses, and this module. The original
 * self-contained guard here modelled only the pbkdf2 kdf, which would have
 * rejected every real (Argon2id) keystore the moment a rotation started.
 */
export type KeystoreV3 = Keystore & { v: 3 };

/** Shape guard for a v3 keystore — `crypto.ts`'s `isKeystore` narrowed to the
 *  rotation-era version. All field rules (canary optional, pending complete-or-
 *  absent, either kdf, forward-compat extra keys) are enforced there. */
export function isKeystoreV3(x: unknown): x is KeystoreV3 {
  return isKeystore(x) && x.v === 3;
}

// ---------------------------------------------------------------------------
// the rotation journal — one-way progress record, resumable from any crash
// ---------------------------------------------------------------------------

/**
 * The rotation's phases, in strict one-way order:
 *  - `dual-wrapped`: the keystore now holds both wraps; no blob rewritten yet.
 *  - `walking`: re-sealing each blob under MK2, one at a time.
 *  - `verifying`: confirming each blob OPENS under MK2 before anything is retired.
 *  - `promoting`: the point of no return — the old wrap is being dropped.
 * There is deliberately no backward transition function: progress only advances.
 */
export type RotationPhase =
  | "dual-wrapped"
  | "walking"
  | "verifying"
  | "promoting";

/**
 * The rotation's progress journal — stored sealed alongside the keystore so any
 * device can resume from it. `id` is minted once at the start and echoed in the
 * keystore's `pending.rotation_id`; a device that finds a journal whose id doesn't
 * match the live keystore refuses to touch it (someone else's rotation, or a torn
 * state a human should look at — see `canResume`). `rewritten`/`verified` are the
 * per-phase progress sets that make the walk resumable to the exact blob.
 */
export interface RotationJournal {
  v: 1;
  /** Random id minted at start; refuses a second concurrent rotation. */
  id: string;
  /** ISO timestamp — informational only, never gated on. */
  startedAt: string;
  phase: RotationPhase;
  /** Blob paths confirmed RE-SEALED under MK2 (walking phase). */
  rewritten: string[];
  /** Blob paths confirmed to OPEN under MK2 (verifying phase). */
  verified: string[];
}

const PHASES: ReadonlySet<string> = new Set<RotationPhase>([
  "dual-wrapped",
  "walking",
  "verifying",
  "promoting",
]);

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((e) => typeof e === "string");
}

/**
 * Shape guard for a parsed journal. Enforces the structural invariants only —
 * v===1, a non-empty id, a string timestamp, a phase from the fixed vocabulary,
 * and string-array progress sets. Extra unknown keys ride through untouched so an
 * older client never rejects a journal a newer one wrote.
 */
export function isRotationJournal(x: unknown): x is RotationJournal {
  if (typeof x !== "object" || x === null) return false;
  const j = x as Record<string, unknown>;
  if (j.v !== 1) return false;
  if (typeof j.id !== "string" || j.id.length === 0) return false;
  if (typeof j.startedAt !== "string") return false;
  if (typeof j.phase !== "string" || !PHASES.has(j.phase)) return false;
  if (!isStringArray(j.rewritten) || !isStringArray(j.verified)) return false;
  return true;
}

/** A fresh journal at the very start of a rotation: dual-wrapped, no progress. The
 *  caller writes the two-wrap keystore in the same breath. */
export function newJournal(id: string, startedAt: string): RotationJournal {
  return {
    v: 1,
    id,
    startedAt,
    phase: "dual-wrapped",
    rewritten: [],
    verified: [],
  };
}

// ---------------------------------------------------------------------------
// planning — what's left, resumable from any crash
// ---------------------------------------------------------------------------

/**
 * Diff the LIVE blob listing against the journal to compute the remaining work,
 * resumable from any crash. Outputs keep the input listing's order (no sorting
 * surprises for the walk UI).
 *
 *  - `dual-wrapped`: nothing rewritten yet → every listed path is `toRewrite`.
 *  - `walking`: `toRewrite` = listing − rewritten; nothing to verify yet.
 *  - `verifying`: `toVerify` = the rewritten-but-not-yet-verified listed paths.
 *    A path in the listing that was NEVER rewritten is a blob another device wrote
 *    under MK1 mid-rotation — it re-enters the walk, so it's surfaced in
 *    `toRewrite` (and only there — it isn't verifiable yet), which signals the
 *    caller to drop back to walking it. `toVerify` therefore never contains a
 *    path outside `rewritten`, so `recordVerified` can never reject a planned one.
 *  - `promoting`: everything is done → both lists empty.
 */
export function planRotation(
  listing: string[],
  journal: RotationJournal,
): { toRewrite: string[]; toVerify: string[] } {
  switch (journal.phase) {
    case "dual-wrapped":
      return { toRewrite: [...listing], toVerify: [] };
    case "walking": {
      const rewritten = new Set(journal.rewritten);
      return {
        toRewrite: listing.filter((p) => !rewritten.has(p)),
        toVerify: [],
      };
    }
    case "verifying": {
      const rewritten = new Set(journal.rewritten);
      const verified = new Set(journal.verified);
      return {
        toRewrite: listing.filter((p) => !rewritten.has(p)),
        toVerify: listing.filter((p) => rewritten.has(p) && !verified.has(p)),
      };
    }
    case "promoting":
      return { toRewrite: [], toVerify: [] };
  }
}

// ---------------------------------------------------------------------------
// transition guards — illegal states unrepresentable; each returns a NEW journal
// ---------------------------------------------------------------------------

/** dual-wrapped → walking. Throws from any other phase. The caller writes the
 *  two-wrap keystore before this; a SECOND concurrent rotation is refused earlier,
 *  by `canResume` seeing a foreign id — not by attempting `beginWalking` twice. */
export function beginWalking(j: RotationJournal): RotationJournal {
  if (j.phase !== "dual-wrapped")
    throw new Error(
      `beginWalking: expected phase "dual-wrapped", got "${j.phase}"`,
    );
  return { ...j, phase: "walking" };
}

/** Record one blob re-sealed under MK2. Walking phase only; idempotent per path
 *  (a path already recorded yields an equal journal, so a crash-then-resume that
 *  re-seals the same blob doesn't double-count it). */
export function recordRewritten(
  j: RotationJournal,
  path: string,
): RotationJournal {
  if (j.phase !== "walking")
    throw new Error(
      `recordRewritten: expected phase "walking", got "${j.phase}"`,
    );
  const rewritten = j.rewritten.includes(path)
    ? [...j.rewritten]
    : [...j.rewritten, path];
  return { ...j, rewritten };
}

/**
 * walking → verifying. THROWS unless every path in the live listing has been
 * rewritten — the gate that guarantees no blob is left sealed under MK1 before the
 * verify pass begins.
 */
export function beginVerifying(
  j: RotationJournal,
  listing: string[],
): RotationJournal {
  if (j.phase !== "walking")
    throw new Error(
      `beginVerifying: expected phase "walking", got "${j.phase}"`,
    );
  const rewritten = new Set(j.rewritten);
  const missing = listing.filter((p) => !rewritten.has(p));
  if (missing.length > 0)
    throw new Error(
      `beginVerifying: ${missing.length} path(s) not yet rewritten: ${missing.join(", ")}`,
    );
  return { ...j, phase: "verifying" };
}

/** Record one blob confirmed to OPEN under MK2. Verifying phase only; the path
 *  MUST already be in `rewritten` (you cannot verify what was never re-sealed).
 *  Idempotent per path. */
export function recordVerified(
  j: RotationJournal,
  path: string,
): RotationJournal {
  if (j.phase !== "verifying")
    throw new Error(
      `recordVerified: expected phase "verifying", got "${j.phase}"`,
    );
  if (!j.rewritten.includes(path))
    throw new Error(`recordVerified: "${path}" was never rewritten`);
  const verified = j.verified.includes(path)
    ? [...j.verified]
    : [...j.verified, path];
  return { ...j, verified };
}

/**
 * verifying|promoting → walking: the ONE sanctioned backward transition, and
 * only on proof of a mid-rotation writer — a path in the live listing that was
 * never rewritten (another device, still unlocked under MK1, wrote a new blob
 * after the walk passed it). The module doc's "no backward transition" holds
 * for progress (`rewritten`/`verified` never shrink); the PHASE may step back
 * because the true point of no return is the keystore promotion WRITE, not the
 * journal phase — until `pending` is dropped, walking again is always safe
 * under the invariant. Throws without that proof, so it can never be used to
 * casually rewind a rotation.
 */
export function resumeWalking(
  j: RotationJournal,
  listing: string[],
): RotationJournal {
  if (j.phase !== "verifying" && j.phase !== "promoting")
    throw new Error(
      `resumeWalking: expected phase "verifying" or "promoting", got "${j.phase}"`,
    );
  const rewritten = new Set(j.rewritten);
  const missing = listing.filter((p) => !rewritten.has(p));
  if (missing.length === 0)
    throw new Error("resumeWalking: no un-rewritten path in the listing");
  return { ...j, phase: "walking" };
}

/**
 * verifying → promoting. THROWS unless every path in the live listing has been
 * verified — the precondition for the point of no return, where the caller drops
 * the old wrap. After this, only MK2 survives, so every blob MUST already open
 * under it.
 */
export function beginPromoting(
  j: RotationJournal,
  listing: string[],
): RotationJournal {
  if (j.phase !== "verifying")
    throw new Error(
      `beginPromoting: expected phase "verifying", got "${j.phase}"`,
    );
  const verified = new Set(j.verified);
  const missing = listing.filter((p) => !verified.has(p));
  if (missing.length > 0)
    throw new Error(
      `beginPromoting: ${missing.length} path(s) not yet verified: ${missing.join(", ")}`,
    );
  return { ...j, phase: "promoting" };
}

// ---------------------------------------------------------------------------
// resume decision — is this journal ours to continue?
// ---------------------------------------------------------------------------

/**
 * A device that finds an existing journal: `"resume"` when the live keystore is
 * mid-rotation (`pending` present) under the SAME id, else `"refuse"`. A different
 * id means another device's rotation; a keystore with no `pending` means the
 * journal doesn't match a rotation the keystore is actually in — a torn state a
 * human should look at rather than a machine steamroll.
 */
export function canResume(
  journal: RotationJournal,
  keystore: KeystoreV3,
): "resume" | "refuse" {
  if (keystore.pending === undefined) return "refuse";
  return keystore.pending.rotation_id === journal.id ? "resume" : "refuse";
}
