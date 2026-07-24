"use client";

import { bumpSeenSeq, getSeenSeq } from "@/lib/keycache";
import { isRolledBack, servedSeqOf, type Seqed } from "@/lib/seqrule";

/**
 * The sealed-seq rollback check + its alarm (58b, lib/seqrule): each fixed
 * config store's primary surface calls `checkSeqAndRemember` after a
 * successful open (and on a 404 — an absent record this device has seen is
 * the same alarm), renders <SeqAlarm> when it trips, and bumps the memory on
 * every clean read and successful save. IDB trouble reads as "no memory" —
 * never a false alarm, never a false pass recorded.
 */

/** True = the store served older state than this device has verified. */
export async function checkSeqAndRemember(
  store: string,
  cfg: Seqed | null,
): Promise<boolean> {
  try {
    const served = servedSeqOf(cfg);
    const seen = await getSeenSeq(store);
    if (isRolledBack(served, seen)) return true;
    await bumpSeenSeq(store, served);
    return false;
  } catch {
    return false;
  }
}

/** Best-effort memory bump after a successful save (the device now KNOWS this
 *  seq exists, even if it never reads it back before the next visit). */
export function rememberSavedSeq(store: string, cfg: Seqed): void {
  void bumpSeenSeq(store, cfg.seq ?? 0).catch(() => {});
}

export function SeqAlarm({ what }: { what: string }) {
  return (
    <div className="mb-3 border border-down/60 px-3 py-2 text-xs text-down">
      <p className="font-semibold uppercase tracking-[0.15em]">
        rollback alarm
      </p>
      <p className="mt-1">
        the served {what} is OLDER than what this device has already seen —
        stale state is being served, or the record was deleted.
      </p>
      <p className="mt-1 text-down/80">
        saving now would overwrite the newer data — check another device first.
      </p>
    </div>
  );
}
