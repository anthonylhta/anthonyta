/**
 * rotationdriver — the I/O engine that executes a master-key rotation (ADR 0090
 * core, ADR 0103/0104 plumbing): dual-wrap → walk (re-seal every blob) → verify
 * (every blob opens under MK2) → promote (drop the old wrap). All effects go
 * through an injected `RotationIo` adapter, so the whole engine is crash-tested
 * in vitest against real crypto and a fake store — the browser panel supplies
 * the fetch-backed adapter and stays a thin shell (the prfCeremony pattern).
 *
 * Order-of-writes invariants this module encodes (each proven by a kill in the
 * crash matrix):
 *  - At start, the TWO-WRAP KEYSTORE is written BEFORE the journal. The journal
 *    is sealed under MK2; if the journal went first and the keystore write died,
 *    MK2 would exist nowhere and the sealed journal would be unreadable forever
 *    (and its no-clobber first write would block every future rotation). With
 *    keystore-first, a death between the two leaves `pending` in place and the
 *    journal is simply recreated from `pending.rotation_id` — nothing walked
 *    yet, nothing lost.
 *  - The true point of no return is the PROMOTION KEYSTORE WRITE (dropping
 *    `pending`), not any journal phase — which is why `resumeWalking` may step
 *    the phase back on proof of a mid-rotation writer, and why every phase
 *    re-checks the live listing before advancing.
 *  - A blob that fails to open under MK1 but opens under MK2 was rewritten by a
 *    session that died before journaling — record it and move on (idempotent).
 *    A blob that opens under NEITHER halts the rotation by name; promotion is
 *    unreachable past it, so a corrupt blob can never be silently retired.
 */

import { ROTATION_CONTEXT } from "./aevcontext";
import {
  fromB64url,
  generateMk,
  open,
  randomId,
  seal,
  sealCanary,
  toB64url,
  unwrapMk,
  wrapMk,
  type EnvelopeMeta,
  type Keystore,
} from "./crypto";
import { isDropboxKey, type DropboxKey } from "./dropbox";
import { deriveKekForKdf } from "./kdf";
import { buildManifest, hashBytes, isManifest } from "./merkle";
import {
  beginPromoting,
  beginVerifying,
  beginWalking,
  canResume,
  isRotationJournal,
  newJournal,
  planRotation,
  recordRewritten,
  recordVerified,
  resumeWalking,
  type KeystoreV3,
  type RotationJournal,
} from "./rotate";
import {
  classifyKey,
  partitionEstate,
  type EstatePartition,
} from "./rotationset";
import { VAULT_MANIFEST_PATH, VAULT_PREFIX } from "./vaultblob";

// ---------------------------------------------------------------------------
// the adapter — every effect the engine performs, injectable
// ---------------------------------------------------------------------------

export interface RotationIo {
  /** Parsed keystore, or null when absent. */
  getKeystore(): Promise<Keystore | null>;
  /** Overwrite-write the keystore (the walk always overwrites). */
  putKeystore(ks: Keystore): Promise<boolean>;
  /** Raw journal envelope bytes. */
  getJournal(): Promise<Uint8Array | "absent" | "error">;
  putJournal(
    bytes: Uint8Array,
    overwrite: boolean,
  ): Promise<"ok" | "conflict" | "failed">;
  deleteJournal(): Promise<boolean>;
  /** Every key in the estate, or null when it cannot be known (NEVER partial). */
  listEstate(): Promise<string[] | null>;
  /** Raw envelope bytes for one blob (route resolved per kind), null = unreadable. */
  readBlob(key: string): Promise<Uint8Array | null>;
  writeBlob(key: string, bytes: Uint8Array): Promise<boolean>;
  getDropboxKey(): Promise<DropboxKey | null>;
  putDropboxKey(rec: DropboxKey): Promise<boolean>;
  /** Overwrite the PRF wrap set with an empty one (promotion drops every wrap). */
  dropPrfWraps(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// outcomes
// ---------------------------------------------------------------------------

/** A hard stop. `code` is the machine-readable reason; `keys` names blobs when
 *  the reason is about specific ones (unknown estate keys, an unopenable blob). */
export class RotationHalt extends Error {
  constructor(
    public code:
      | "no-vault"
      | "passphrase"
      | "torn"
      | "orphaned-journal"
      | "already-in-flight"
      | "nothing-in-flight"
      | "journal-conflict"
      | "unknown-keys"
      | "unopenable"
      | "io",
    message: string,
    public keys: string[] = [],
  ) {
    super(message);
    this.name = "RotationHalt";
  }
}

/** Live handle on an in-flight rotation: the v3 keystore, the journal as last
 *  persisted, and both unwrapped keys (memory only — never cached). */
export interface RotationSession {
  ks: KeystoreV3;
  journal: RotationJournal;
  mk1: CryptoKey;
  mk2: CryptoKey;
}

export type PhaseResult =
  | { status: "ok" }
  /** The live listing surfaced blobs the walk never rewrote (a mid-rotation
   *  writer) — the phase stepped the journal back; run the walk again. */
  | { status: "rewalk" };

export interface PromotionResult {
  promoted: true;
  /** False = the wrap-set overwrite failed AFTER promotion; the stale wraps
   *  fail their canary at next use, but retry the drop (finishStaleRotation). */
  prfDropped: boolean;
  journalDeleted: boolean;
}

export interface RotationProgress {
  phase: "walking" | "verifying";
  done: number;
  total: number;
  key: string;
}

export type ProbeStatus =
  | "no-vault"
  | "idle"
  | "in-flight"
  | "stale-journal"
  | "error";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const hasPending = (
  ks: Keystore,
): ks is KeystoreV3 & { pending: NonNullable<Keystore["pending"]> } =>
  ks.v === 3 && ks.pending !== undefined;

async function sealJournal(
  mk2: CryptoKey,
  j: RotationJournal,
): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(j));
  const meta: EnvelopeMeta = {
    n: "rotation-journal",
    t: "application/json",
    s: bytes.length,
  };
  return seal(mk2, meta, bytes, ROTATION_CONTEXT);
}

/** Persist a journal step (overwrite) and thread it into the session. */
async function saveJournal(
  io: RotationIo,
  s: RotationSession,
  j: RotationJournal,
): Promise<void> {
  const wrote = await io.putJournal(await sealJournal(s.mk2, j), true);
  if (wrote !== "ok")
    throw new RotationHalt("io", "journal write failed — nothing advanced");
  s.journal = j;
}

async function unlockPrimary(io: RotationIo, passphrase: string) {
  const ks = await io.getKeystore();
  if (ks === null) throw new RotationHalt("no-vault", "no keystore exists");
  const kek = await deriveKekForKdf(ks.kdf, passphrase);
  let mk1: CryptoKey;
  try {
    mk1 = await unwrapMk(
      fromB64url(ks.wrapped_mk_b64),
      fromB64url(ks.iv_b64),
      kek,
    );
  } catch {
    throw new RotationHalt("passphrase", "wrong passphrase");
  }
  return { ks, kek, mk1 };
}

/** List + classify the live estate, refusing on any unknown key. */
async function classifiedEstate(io: RotationIo): Promise<EstatePartition> {
  const listing = await io.listEstate();
  if (listing === null)
    throw new RotationHalt("io", "the estate cannot be listed — refusing");
  const part = partitionEstate(listing);
  if (part.unknown.length > 0)
    throw new RotationHalt(
      "unknown-keys",
      `${part.unknown.length} unclassified key(s) — classify or remove them, then retry`,
      part.unknown,
    );
  return part;
}

/** Expose the partition for the panel's pre-flight display (counts + refusals)
 *  without needing a passphrase. */
export async function inspectEstate(io: RotationIo): Promise<EstatePartition> {
  const listing = await io.listEstate();
  if (listing === null)
    throw new RotationHalt("io", "the estate cannot be listed");
  return partitionEstate(listing);
}

// ---------------------------------------------------------------------------
// probe — what state is the world in? (no passphrase needed)
// ---------------------------------------------------------------------------

export async function probeRotation(io: RotationIo): Promise<ProbeStatus> {
  try {
    const ks = await io.getKeystore();
    if (ks === null) return "no-vault";
    if (hasPending(ks)) return "in-flight";
    const j = await io.getJournal();
    if (j === "error") return "error";
    if (j !== "absent") return "stale-journal";
    return "idle";
  } catch {
    return "error";
  }
}

// ---------------------------------------------------------------------------
// begin / resume / finish-stale
// ---------------------------------------------------------------------------

/**
 * Start a fresh rotation: mint MK2, write the TWO-WRAP keystore FIRST, then the
 * sealed journal (see the module doc for why this order is load-bearing).
 * Refuses when one is already in flight or a journal exists (finish or resume
 * those first — begin never steamrolls state it didn't create).
 */
export async function beginRotation(
  io: RotationIo,
  passphrase: string,
): Promise<RotationSession> {
  const { ks, kek, mk1 } = await unlockPrimary(io, passphrase);
  if (hasPending(ks))
    throw new RotationHalt(
      "already-in-flight",
      "a rotation is already in flight — resume it",
    );
  const existing = await io.getJournal();
  if (existing === "error") throw new RotationHalt("io", "journal read failed");
  if (existing !== "absent")
    throw new RotationHalt(
      "torn",
      "a journal exists without a pending wrap — finish the stale rotation first",
    );

  // Mint MK2 and dual-wrap. The extractable handle from generateMk is used only
  // to produce the wrap, then dropped for the non-extractable unwrap result.
  const mk2x = await generateMk();
  const { wrapped, iv } = await wrapMk(mk2x, kek);
  const id = randomId();
  const ksV3 = {
    v: 3,
    kdf: ks.kdf,
    wrapped_mk_b64: ks.wrapped_mk_b64,
    iv_b64: ks.iv_b64,
    ...(ks.canary_b64 !== undefined ? { canary_b64: ks.canary_b64 } : {}),
    pending: {
      wrapped_mk_b64: toB64url(wrapped),
      iv_b64: toB64url(iv),
      rotation_id: id,
    },
  } as KeystoreV3;
  if (!(await io.putKeystore(ksV3)))
    throw new RotationHalt("io", "keystore dual-wrap write failed");

  const mk2 = await unwrapMk(wrapped, iv, kek);
  const journal = newJournal(id, new Date().toISOString());
  const wrote = await io.putJournal(await sealJournal(mk2, journal), false);
  if (wrote === "conflict")
    throw new RotationHalt(
      "journal-conflict",
      "a journal appeared mid-start — resume instead",
    );
  if (wrote !== "ok") throw new RotationHalt("io", "journal write failed");
  return { ks: ksV3, journal, mk1, mk2 };
}

/**
 * Resume an in-flight rotation (keystore carries `pending`). A missing journal
 * is the begin-crash window — recreated fresh from `pending.rotation_id` with
 * no progress, which is exactly what was true when the start died.
 */
export async function resumeRotation(
  io: RotationIo,
  passphrase: string,
): Promise<RotationSession> {
  const { ks, kek, mk1 } = await unlockPrimary(io, passphrase);
  if (!hasPending(ks))
    throw new RotationHalt("nothing-in-flight", "no rotation is in flight");
  let mk2: CryptoKey;
  try {
    mk2 = await unwrapMk(
      fromB64url(ks.pending.wrapped_mk_b64),
      fromB64url(ks.pending.iv_b64),
      kek,
    );
  } catch {
    // The primary unwrapped under this KEK, so the passphrase is right — a
    // pending that doesn't is a torn keystore, not a typo.
    throw new RotationHalt("torn", "the pending wrap does not unwrap");
  }

  const raw = await io.getJournal();
  if (raw === "error") throw new RotationHalt("io", "journal read failed");
  if (raw === "absent") {
    const journal = newJournal(
      ks.pending.rotation_id,
      new Date().toISOString(),
    );
    const wrote = await io.putJournal(await sealJournal(mk2, journal), false);
    if (wrote !== "ok") throw new RotationHalt("io", "journal recreate failed");
    return { ks, journal, mk1, mk2 };
  }

  let journal: RotationJournal;
  try {
    const opened = await open(mk2, raw, ROTATION_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(opened.bytes));
    if (!isRotationJournal(parsed)) throw new Error("malformed");
    journal = parsed;
  } catch {
    throw new RotationHalt(
      "orphaned-journal",
      "the journal does not open under the pending key — manual attention",
    );
  }
  if (canResume(journal, ks) !== "resume")
    throw new RotationHalt(
      "torn",
      "journal and keystore describe different rotations — manual attention",
    );
  return { ks, journal, mk1, mk2 };
}

/**
 * Finish a rotation that promoted its keystore but died before cleanup (probe:
 * "stale-journal"). The old MK2 is now the PRIMARY, so the journal opens under
 * it; a journal in any phase before `promoting` alongside a pending-less
 * keystore is torn — surfaced, never steamrolled.
 */
export async function finishStaleRotation(
  io: RotationIo,
  passphrase: string,
): Promise<void> {
  const { ks, mk1 } = await unlockPrimary(io, passphrase);
  if (hasPending(ks))
    throw new RotationHalt(
      "already-in-flight",
      "a rotation is in flight — resume it instead",
    );
  const raw = await io.getJournal();
  if (raw === "error") throw new RotationHalt("io", "journal read failed");
  if (raw === "absent") return; // nothing stale — already clean
  let journal: RotationJournal;
  try {
    const opened = await open(mk1, raw, ROTATION_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(opened.bytes));
    if (!isRotationJournal(parsed)) throw new Error("malformed");
    journal = parsed;
  } catch {
    throw new RotationHalt(
      "orphaned-journal",
      "the stale journal does not open under the current key — manual attention",
    );
  }
  if (journal.phase !== "promoting")
    throw new RotationHalt(
      "torn",
      `a ${journal.phase}-phase journal with no pending wrap — manual attention`,
    );
  if (!(await io.dropPrfWraps()))
    throw new RotationHalt("io", "PRF wrap drop failed — retry");
  if (!(await io.deleteJournal()))
    throw new RotationHalt("io", "journal delete failed — retry");
}

// ---------------------------------------------------------------------------
// the walk
// ---------------------------------------------------------------------------

async function rewriteEnvelope(
  io: RotationIo,
  s: RotationSession,
  key: string,
  context: string | undefined,
  hashCache: Map<string, string>,
): Promise<void> {
  const raw = await io.readBlob(key);
  if (raw === null) throw new RotationHalt("io", `cannot read ${key}`, [key]);
  const isVault = key.startsWith(VAULT_PREFIX);
  // The open is fenced off ALONE: only a crypto refusal may route into the
  // "already under MK2?" fallback. An I/O throw from the write below must
  // propagate as itself — the first crash-matrix run caught it being swallowed
  // here and re-reported as a (false) corruption halt.
  let opened: { meta: EnvelopeMeta; bytes: Uint8Array } | null;
  try {
    opened = await open(s.mk1, raw, context);
  } catch {
    opened = null;
  }
  if (opened !== null) {
    const sealed = await seal(s.mk2, opened.meta, opened.bytes, context);
    if (!(await io.writeBlob(key, sealed)))
      throw new RotationHalt("io", `cannot write ${key}`, [key]);
    if (isVault) hashCache.set(key, await hashBytes(sealed));
    return;
  }
  // MK1 refused. A session that died between upload and journal leaves the
  // blob already under MK2 — verify that before calling anything corrupt.
  try {
    await open(s.mk2, raw, context);
  } catch {
    throw new RotationHalt(
      "unopenable",
      `${key} opens under NEITHER key — resolve before any promotion`,
      [key],
    );
  }
  if (isVault) hashCache.set(key, await hashBytes(raw));
}

async function rewriteDropboxKey(
  io: RotationIo,
  s: RotationSession,
): Promise<void> {
  const rec = await io.getDropboxKey();
  if (rec === null || !isDropboxKey(rec))
    throw new RotationHalt("io", "cannot read the dropbox key record");
  const sealedPriv = fromB64url(rec.sealed_priv_b64);
  // Open fenced alone, exactly as in rewriteEnvelope: an I/O throw from the
  // record write must never be misread as "MK1 refused".
  let opened: { meta: EnvelopeMeta; bytes: Uint8Array } | null;
  try {
    opened = await open(s.mk1, sealedPriv);
  } catch {
    opened = null;
  }
  if (opened !== null) {
    const resealed = await seal(s.mk2, opened.meta, opened.bytes);
    // pub_b64 rides through UNTOUCHED — strangers encrypt to it (ADR 0062).
    if (
      !(await io.putDropboxKey({
        ...rec,
        sealed_priv_b64: toB64url(resealed),
      }))
    )
      throw new RotationHalt("io", "cannot write the dropbox key record");
    return;
  }
  try {
    await open(s.mk2, sealedPriv);
  } catch {
    throw new RotationHalt(
      "unopenable",
      "the dropbox private key opens under NEITHER key",
      ["meta/dropboxkey"],
    );
  }
}

async function rebuildVaultManifest(
  io: RotationIo,
  s: RotationSession,
  part: EstatePartition,
  hashCache: Map<string, string>,
): Promise<void> {
  const raw = await io.readBlob(VAULT_MANIFEST_PATH);
  if (raw === null)
    throw new RotationHalt("io", `cannot read ${VAULT_MANIFEST_PATH}`);
  let epoch: number;
  try {
    const { bytes } = await open(s.mk1, raw);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    epoch = isManifest(parsed) ? parsed.epoch + 1 : 1;
  } catch {
    try {
      // Already rebuilt by a session that died before journaling — done.
      await open(s.mk2, raw);
      return;
    } catch {
      // Unreadable prior manifest: epoch restarts at 1 (vault-sync's rule);
      // the reader's epoch memory will flag it and the next sync heals.
      epoch = 1;
    }
  }
  const vaultKeys = part.walk.filter(
    (k) => k.startsWith(VAULT_PREFIX) && k !== VAULT_MANIFEST_PATH,
  );
  const entries = [];
  for (const k of vaultKeys) {
    let h = hashCache.get(k);
    if (h === undefined) {
      // Rewritten in an earlier session — hash the bytes as they sit at rest
      // (hashing needs no decryption; the manifest attests served bytes).
      const bytes = await io.readBlob(k);
      if (bytes === null)
        throw new RotationHalt("io", `cannot read ${k} for the manifest`, [k]);
      h = await hashBytes(bytes);
    }
    entries.push({ path: k, h });
  }
  const manifest = await buildManifest(entries, epoch);
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  // Seal EXACTLY as vault-sync does (AEV1, same meta) so /vault's verifier
  // reads it unchanged.
  const sealed = await seal(
    s.mk2,
    { n: "manifest", t: "application/json", s: bytes.length },
    bytes,
  );
  if (!(await io.writeBlob(VAULT_MANIFEST_PATH, sealed)))
    throw new RotationHalt("io", `cannot write ${VAULT_MANIFEST_PATH}`);
}

/** Walk every un-rewritten blob: open under MK1, re-seal under MK2, overwrite,
 *  journal — resumable to the exact blob. Ends by gating into `verifying`. */
export async function runWalk(
  io: RotationIo,
  s: RotationSession,
  onProgress?: (p: RotationProgress) => void,
): Promise<PhaseResult> {
  const part = await classifiedEstate(io);

  if (s.journal.phase === "dual-wrapped")
    await saveJournal(io, s, beginWalking(s.journal));
  else if (s.journal.phase !== "walking") {
    // verifying/promoting: only legal here when the listing proves new work.
    const plan = planRotation(part.walk, s.journal);
    if (plan.toRewrite.length === 0) return { status: "ok" };
    await saveJournal(io, s, resumeWalking(s.journal, part.walk));
  }

  const plan = planRotation(part.walk, s.journal);
  const hashCache = new Map<string, string>();
  const total = plan.toRewrite.length;
  for (let i = 0; i < total; i++) {
    const key = plan.toRewrite[i];
    onProgress?.({ phase: "walking", done: i, total, key });
    const c = classifyKey(key);
    if (c.action !== "rewrite")
      throw new RotationHalt("io", `listing drifted mid-walk at ${key}`, [key]);
    if (c.kind === "manifest")
      await rebuildVaultManifest(io, s, part, hashCache);
    else if (c.kind === "dropboxkey") await rewriteDropboxKey(io, s);
    else await rewriteEnvelope(io, s, key, c.context, hashCache);
    await saveJournal(io, s, recordRewritten(s.journal, key));
  }

  await saveJournal(io, s, beginVerifying(s.journal, part.walk));
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// the verify pass
// ---------------------------------------------------------------------------

/** Prove every rewritten blob OPENS under MK2 before anything is retired. A
 *  blob that meanwhile reverted to MK1 (a concurrent writer's 409-dance win)
 *  is re-sealed on the spot; one that opens under neither halts by name. */
export async function runVerify(
  io: RotationIo,
  s: RotationSession,
  onProgress?: (p: RotationProgress) => void,
): Promise<PhaseResult> {
  const part = await classifiedEstate(io);
  if (s.journal.phase !== "verifying")
    throw new RotationHalt("torn", `runVerify in phase ${s.journal.phase}`);

  {
    const plan = planRotation(part.walk, s.journal);
    if (plan.toRewrite.length > 0) {
      await saveJournal(io, s, resumeWalking(s.journal, part.walk));
      return { status: "rewalk" };
    }
  }

  const plan = planRotation(part.walk, s.journal);
  const total = plan.toVerify.length;
  for (let i = 0; i < total; i++) {
    const key = plan.toVerify[i];
    onProgress?.({ phase: "verifying", done: i, total, key });
    const c = classifyKey(key);
    if (c.action !== "rewrite")
      throw new RotationHalt("io", `listing drifted mid-verify at ${key}`, [
        key,
      ]);

    if (c.kind === "dropboxkey") {
      const rec = await io.getDropboxKey();
      if (rec === null || !isDropboxKey(rec))
        throw new RotationHalt("io", "cannot read the dropbox key record");
      try {
        await open(s.mk2, fromB64url(rec.sealed_priv_b64));
      } catch {
        await rewriteDropboxKey(io, s); // reverted or torn — re-seal or halt
        await open(
          s.mk2,
          fromB64url((await io.getDropboxKey())!.sealed_priv_b64),
        );
      }
    } else {
      const context = c.kind === "envelope" ? c.context : undefined;
      const raw = await io.readBlob(key);
      if (raw === null)
        throw new RotationHalt("io", `cannot read ${key}`, [key]);
      try {
        await open(s.mk2, raw, context);
      } catch {
        // Reverted to MK1 by a concurrent writer? Re-seal now; a blob under
        // neither key halts inside rewriteEnvelope with its name.
        await rewriteEnvelope(io, s, key, context, new Map());
      }
    }
    await saveJournal(io, s, recordVerified(s.journal, key));
  }

  // One fresh look before the gate: a writer may have landed since the listing
  // above. planRotation surfaces it as un-rewritten work.
  const finalPart = await classifiedEstate(io);
  const finalPlan = planRotation(finalPart.walk, s.journal);
  if (finalPlan.toRewrite.length > 0) {
    await saveJournal(io, s, resumeWalking(s.journal, finalPart.walk));
    return { status: "rewalk" };
  }
  if (finalPlan.toVerify.length > 0) return runVerify(io, s, onProgress);

  await saveJournal(io, s, beginPromoting(s.journal, finalPart.walk));
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// promotion — the point of no return
// ---------------------------------------------------------------------------

/**
 * Drop the old wrap: write a v2 keystore whose primary IS the pending wrap
 * (moved verbatim — no passphrase needed) with the canary re-sealed under MK2,
 * then drop every PRF wrap (their KEKs can only ever re-derive on their own
 * authenticators — re-enrollment is the designed follow-up) and delete the
 * journal. One final listing check first: past the keystore write, MK1 is gone.
 */
export async function runPromotion(
  io: RotationIo,
  s: RotationSession,
): Promise<PromotionResult | { status: "rewalk" }> {
  if (s.journal.phase !== "promoting")
    throw new RotationHalt("torn", `runPromotion in phase ${s.journal.phase}`);

  const part = await classifiedEstate(io);
  const rewritten = new Set(s.journal.rewritten);
  if (part.walk.some((k) => !rewritten.has(k))) {
    await saveJournal(io, s, resumeWalking(s.journal, part.walk));
    return { status: "rewalk" };
  }

  const promoted: Keystore = {
    v: 2,
    kdf: s.ks.kdf,
    wrapped_mk_b64: s.ks.pending!.wrapped_mk_b64,
    iv_b64: s.ks.pending!.iv_b64,
    canary_b64: await sealCanary(s.mk2),
  };
  if (!(await io.putKeystore(promoted)))
    throw new RotationHalt("io", "promotion keystore write failed");

  const prfDropped = await io.dropPrfWraps();
  const journalDeleted = prfDropped ? await io.deleteJournal() : false;
  return { promoted: true, prfDropped, journalDeleted };
}

// ---------------------------------------------------------------------------
// the full drive — phase routing shared by the panel and the crash tests
// ---------------------------------------------------------------------------

/**
 * Drive a live session to promotion, whatever phase it resumed in: walk when
 * there is walking to do, verify when verifying, promote when promoting — and
 * loop on any `rewalk` (a mid-rotation writer). Bounded so a writer landing
 * new MK1 blobs every pass surfaces as a halt instead of an endless loop.
 */
export async function completeRotation(
  io: RotationIo,
  s: RotationSession,
  onProgress?: (p: RotationProgress) => void,
): Promise<PromotionResult> {
  for (let i = 0; i < 6; i++) {
    if (s.journal.phase === "dual-wrapped" || s.journal.phase === "walking")
      await runWalk(io, s, onProgress);
    if (s.journal.phase === "verifying") {
      const v = await runVerify(io, s, onProgress);
      if (v.status === "rewalk") continue;
    }
    if (s.journal.phase === "promoting") {
      const p = await runPromotion(io, s);
      if ("status" in p) continue;
      return p;
    }
  }
  throw new RotationHalt(
    "io",
    "rotation did not converge — a writer keeps landing new blobs; lock other devices and retry",
  );
}
