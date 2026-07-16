/**
 * Pure hash-chained core for the auth journal — the tamper-evident record of the
 * security events the SERVER writes (sign-ins, credential enrollments, keystore
 * overwrites). Unlike everything else in the hub this record can't be E2EE (the
 * server is its author) and doesn't need to be — entries carry no secrets. What it
 * needs is tamper evidence AGAINST ITS OWN AUTHOR: each entry commits to the
 * previous one (h = SHA-256 over prev.h ‖ this entry), so the server can append
 * honestly or break the chain visibly, but it cannot EDIT a past entry and have the
 * chain still verify — the recompute at that seq no longer matches (`verifyChain`).
 *
 * A hash chain alone can't stop two remaining attacks, both of which re-produce a
 * self-consistent chain: TRUNCATION (cut the tail off — every surviving link still
 * verifies) and FULL REWRITE (recompute every hash over doctored history). Both are
 * caught the way certificate transparency catches them: the CLIENT remembers the
 * newest `(seq, h)` tip it has verified, and `compareTip` flags a served log whose
 * tip is older (rolled-back) or whose remembered seq now carries a different hash
 * (rewritten). The device refreshes that memory every visit, so it sits near the tip.
 *
 * No store and no `next` import, no Node-only APIs — only `crypto.subtle` — so this
 * layer runs unchanged in the window, a worker, and Node-vitest, and is unit-testable
 * on its own (mirrors lib/merkle + lib/crypto). The R2 I/O + guard-against-self-DoS
 * discipline lives one layer up in lib/authlogstore.
 */

import { toB64url } from "./crypto";

/** What gets journaled. Failures are deliberately NOT journaled — strangers
 *  probing the 404 wall must not be able to write into the owner's journal. */
export type AuthEventKind =
  | "signin" // passkey assertion verified
  | "register" // credential enrolled
  | "remove" // credential removed
  | "recovery" // recovery code consumed
  | "keystore" // keystore overwritten (passphrase change / recovery re-wrap)
  | "prf-add" // PRF vault-unlock wrap added
  | "prf-remove"; // PRF wrap removed

export interface AuthEntry {
  seq: number; // 1-based, contiguous
  ts: string; // ISO-8601, server clock — informational, NOT verified (clock skew)
  kind: AuthEventKind;
  detail: string; // e.g. a credential-id prefix or platform label — never a secret, never an IP
  h: string; // b64url SHA-256 chaining hash
}

export interface AuthLog {
  v: 1;
  /** Entries 1..foldedThrough have been compacted away; 0 = nothing folded. */
  foldedThrough: number;
  /** The chain hash at foldedThrough — GENESIS for a fresh log. Verification of
   *  the first remaining entry starts from this. */
  carry: string;
  entries: AuthEntry[];
}

/** The chain's fixed starting point (prev-hash of entry 1). */
export const GENESIS = "authlog-genesis";

/** Fold threshold + how many recent entries survive a fold. Past FOLD_CAP the log
 *  compacts its oldest links into `carry` so a long-lived journal can't grow without
 *  bound; the carry keeps the boundary verifiable, so a fold loses no tamper evidence
 *  the tip memory still needs (a device near the tip is unaffected). */
export const FOLD_CAP = 512;
export const FOLD_KEEP = 256;

/** Every entry vocabulary member, as a set — the guard's membership test. */
const KINDS: ReadonlySet<string> = new Set<AuthEventKind>([
  "signin",
  "register",
  "remove",
  "recovery",
  "keystore",
  "prf-add",
  "prf-remove",
]);

// Domain-separation prefix. Every preimage begins with "authlog\0" so a chaining
// hash can never collide with a digest computed for any other purpose in the hub
// (the merkle leaves use "leaf\0", the crypto envelopes use their magics) — the NUL
// keeps the label unambiguously fenced off from the prev-hash that follows it.
const HASH_PREFIX = "authlog\0";

/**
 * Canonical serialization of an entry's signed fields, in an EXPLICIT, fixed field
 * order — NEVER `JSON.stringify` of an object, whose key order isn't guaranteed
 * across writers/engines and would make two honest servers compute different hashes
 * for the same event. `seq`, `ts`, and `kind` have fixed shapes (a number, an ISO
 * timestamp, a fixed-vocabulary token — none of which contain "\n"), so `detail`,
 * the only free-form field, sits LAST: a "\n" embedded in it is just data that can't
 * shift the earlier field boundaries, so it can't forge a different entry's canonical
 * form.
 */
function canonical(e: {
  seq: number;
  ts: string;
  kind: AuthEventKind;
  detail: string;
}): string {
  return `${e.seq}\n${e.ts}\n${e.kind}\n${e.detail}`;
}

/**
 * The chaining hash: b64url(SHA-256("authlog\0" ‖ prevH ‖ "\n" ‖ canonical(entry))).
 * String concatenation before encoding IS byte concatenation of the UTF-8 forms (all
 * separators are ASCII), so this is exactly the domain-separated preimage above.
 * `prevH` is the previous entry's `h`, or `carry` for the first remaining entry, or
 * GENESIS on a fresh log.
 */
async function linkHash(
  prevH: string,
  e: { seq: number; ts: string; kind: AuthEventKind; detail: string },
): Promise<string> {
  const bytes = new TextEncoder().encode(
    HASH_PREFIX + prevH + "\n" + canonical(e),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toB64url(new Uint8Array(digest));
}

/** A fresh, empty journal: nothing folded, the chain anchored at GENESIS. */
export function emptyLog(): AuthLog {
  return { v: 1, foldedThrough: 0, carry: GENESIS, entries: [] };
}

/**
 * Append one event: seq = tip+1, h = linkHash(prev.h, entry). Applies the fold cap —
 * past FOLD_CAP entries, the oldest are compacted into `carry` until FOLD_KEEP remain
 * (carry becomes the h of the LAST folded entry, foldedThrough its seq, so the next
 * remaining entry's h — already computed from that value — keeps the boundary
 * verifiable). Returns a NEW log; the input and its entries are never mutated.
 */
export async function appendEntry(
  log: AuthLog,
  event: { kind: AuthEventKind; detail: string; ts: string },
): Promise<AuthLog> {
  const tip = tipOf(log);
  const seq = (tip ? tip.seq : 0) + 1;
  const prevH = tip ? tip.h : GENESIS;
  const entry: AuthEntry = {
    seq,
    ts: event.ts,
    kind: event.kind,
    detail: event.detail,
    h: await linkHash(prevH, {
      seq,
      ts: event.ts,
      kind: event.kind,
      detail: event.detail,
    }),
  };

  let entries = [...log.entries, entry];
  let foldedThrough = log.foldedThrough;
  let carry = log.carry;
  if (entries.length > FOLD_CAP) {
    const foldCount = entries.length - FOLD_KEEP;
    const last = entries[foldCount - 1]; // the newest entry being folded away
    foldedThrough = last.seq;
    carry = last.h;
    entries = entries.slice(foldCount);
  }
  return { v: 1, foldedThrough, carry, entries };
}

/**
 * Recompute every link from `carry` forward and also check seq contiguity
 * (foldedThrough+1, +2, …). `atSeq` names the FIRST bad seq — the position where a
 * contiguity gap or a hash mismatch is detected. An honest full log verifies; an
 * edited entry breaks exactly at its seq; a deletion-and-renumber breaks at the
 * splice (the recompute no longer matches the stored hash there).
 */
export async function verifyChain(
  log: AuthLog,
): Promise<{ ok: true } | { ok: false; atSeq: number }> {
  let prevH = log.carry;
  let expectedSeq = log.foldedThrough + 1;
  for (const e of log.entries) {
    if (e.seq !== expectedSeq) return { ok: false, atSeq: expectedSeq };
    if ((await linkHash(prevH, e)) !== e.h) return { ok: false, atSeq: e.seq };
    prevH = e.h;
    expectedSeq++;
  }
  return { ok: true };
}

export interface Tip {
  seq: number;
  h: string;
}

/** The newest entry's (seq, h); for an empty log with folds, (foldedThrough, carry);
 *  null only for a truly empty fresh log. */
export function tipOf(log: AuthLog): Tip | null {
  if (log.entries.length > 0) {
    const last = log.entries[log.entries.length - 1];
    return { seq: last.seq, h: last.h };
  }
  if (log.foldedThrough > 0) return { seq: log.foldedThrough, h: log.carry };
  return null;
}

/**
 * The device-memory check that a plain hash chain can't do alone. "rolled-back" =
 * the served tip is OLDER than what this device last verified (truncation, or a
 * whole stale snapshot). "rewritten" = the remembered seq still EXISTS in the served
 * chain — as an entry, or exactly at the fold boundary as `carry` — but its hash
 * differs, so history was edited and every hash re-computed. A remembered seq that
 * has been folded PAST (seen.seq < foldedThrough) is accepted: an honest fold can
 * outrun a stale memory, and since the client refreshes its memory every visit the
 * memory sits near the tip in practice. A null memory (first-ever sync) trusts the
 * served log by design and pins its tip for next time.
 */
export function compareTip(
  seen: Tip | null,
  log: AuthLog,
): "ok" | "rolled-back" | "rewritten" {
  if (seen === null) return "ok"; // first sync — nothing to compare against
  const tip = tipOf(log);
  if (tip === null) return "rolled-back"; // we remember a tip; the server serves none
  if (seen.seq > tip.seq) return "rolled-back"; // served chain is shorter than remembered
  if (seen.seq < log.foldedThrough) return "ok"; // folded past — an honest fold outran the memory
  if (seen.seq === log.foldedThrough)
    return seen.h === log.carry ? "ok" : "rewritten"; // the boundary, held in carry
  const entry = log.entries.find((e) => e.seq === seen.seq);
  // seen.seq is in (foldedThrough, tip.seq]; a contiguous served log always has it.
  // A missing one means the seq was excised — treat that as a rewrite, not silence.
  if (entry === undefined) return "rewritten";
  return entry.h === seen.h ? "ok" : "rewritten";
}

function isAuthEntry(x: unknown, expectedSeq: number): x is AuthEntry {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.seq === "number" &&
    Number.isInteger(e.seq) &&
    e.seq === expectedSeq && // strictly ascending + contiguous, enforced by the caller
    typeof e.ts === "string" &&
    typeof e.kind === "string" &&
    KINDS.has(e.kind) &&
    typeof e.detail === "string" && // may be "" — an eventless detail is legitimate
    typeof e.h === "string"
  );
}

/**
 * Shape guard for a parsed journal (server PUT gate + client parse). Enforces the
 * structural invariants only — v===1, a sane foldedThrough, a non-empty carry, and
 * seqs that ascend contiguously from foldedThrough+1 — and leaves HASH validity to
 * `verifyChain` (a valid shape with broken hashes is exactly what tamper looks like,
 * so the guard mustn't swallow it). Extra unknown keys ride through untouched, so an
 * older client never rejects a journal a newer one wrote.
 */
export function isAuthLog(x: unknown): x is AuthLog {
  if (typeof x !== "object" || x === null) return false;
  const log = x as Record<string, unknown>;
  if (log.v !== 1) return false;
  if (
    typeof log.foldedThrough !== "number" ||
    !Number.isInteger(log.foldedThrough) ||
    log.foldedThrough < 0
  )
    return false;
  if (typeof log.carry !== "string" || log.carry.length === 0) return false;
  if (!Array.isArray(log.entries)) return false;
  let expectedSeq = log.foldedThrough + 1;
  for (const e of log.entries) {
    if (!isAuthEntry(e, expectedSeq)) return false;
    expectedSeq++;
  }
  return true;
}
