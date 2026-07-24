/**
 * seqrule — the sealed sequence-counter half of 58b's layered rollback
 * detection (ADR 0108; the journal-anchor half covers keystore/prfwrap).
 *
 * Each of the four fixed config stores (fin/transit/todo/totp) carries an
 * optional `seq` INSIDE its sealed payload: a storage-level attacker can serve
 * an older envelope, but cannot edit a counter that lives under the GCM tag.
 * Every save writes `seq = prior + 1`; every primary read compares the served
 * seq against a per-device high-water memory (IDB, monotonic) and alarms when
 * the store serves LESS than this device has already seen — including a 404
 * for a record this device knows existed (served reads as 0).
 *
 * Honest limits, by design (documented in the ADR): a device that never saw
 * the newer state cannot flag the older one; clearing IDB re-trusts the next
 * read; and the stores' existing last-write-wins race means a lost concurrent
 * update can land the same seq twice with different content — an accepted
 * pre-existing behavior, NOT a provider attack, and deliberately not alarmed.
 * Absent `seq` (a pre-feature blob) reads as 0 and heals at the next save.
 */

/** Any config payload that may carry the counter. */
export interface Seqed {
  seq?: number;
}

/** Valid stored counter: absent, or a non-negative safe integer. Guards call
 *  this so a corrupted/hostile seq rejects at the parse boundary. */
export function isValidSeq(x: unknown): boolean {
  return (
    x === undefined ||
    (typeof x === "number" &&
      Number.isInteger(x) &&
      x >= 0 &&
      Number.isSafeInteger(x))
  );
}

/** The counter a save must write: one past whatever the prior state carried. */
export function nextSeq(prior: Seqed): number {
  return (prior.seq ?? 0) + 1;
}

/** The counter a served payload effectively carries (absent → 0: pre-feature
 *  blobs and absent records both read as "nothing newer than genesis"). */
export function servedSeqOf(cfg: Seqed | null): number {
  return cfg?.seq ?? 0;
}

/** The alarm predicate: the store served strictly less than this device has
 *  verified before. `remembered === null` = no memory yet — trust and record. */
export function isRolledBack(
  served: number,
  remembered: number | null,
): boolean {
  return remembered !== null && served < remembered;
}
