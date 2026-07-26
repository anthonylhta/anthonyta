"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { isVaultIndex, VAULT_INDEX_PATH } from "@/lib/vaultblob";

/**
 * JournalPulse — how many vault notes were touched this week, as one segment of the
 * mortal row. It was the last row of the retired activity digest; the digest's other
 * rows became path evidence in the paths band, but journal days belong to no path (the
 * journal is a STREAK and a CONDITION, both of which the sealed sheet already carries
 * adjudicated), so the raw count joins the day's mortal pulse instead.
 *
 * A client island because the count comes from the sealed vault index, which decrypts
 * in the browser. It renders NOTHING at all when the vault isn't unlocked — including
 * its own leading separator, so the row above never trails a dangling "·". A pulse
 * segment has no interesting empty state; the sheet's streak line is where the journal
 * says its real piece.
 */

/** Fetch one sealed vault blob's ciphertext through the same-origin owner-gated proxy. */
async function fetchRaw(p: string): Promise<Uint8Array> {
  const res = await fetch(`/api/vault/raw?p=${encodeURIComponent(p)}`);
  if (!res.ok) throw new Error(`vault raw ${p}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** How many vault notes were touched in the last 7 days. */
function journalThisWeek(notes: { modified: string }[]): number {
  const weekAgo = Date.now() - 7 * 86_400_000;
  return notes.filter((n) => Date.parse(n.modified) >= weekAgo).length;
}

export function JournalPulse({ offline }: { offline: boolean }) {
  const { status, openItem } = useVault(offline);
  const [count, setCount] = useState<number | null>(null);

  // Render-phase reset: drop the decrypted figure the moment the vault stops being
  // unlocked, per the lint-blessed reset pattern (useFinTotals / VaultTodayGlance).
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) setCount(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const { bytes } = await openItem(await fetchRaw(VAULT_INDEX_PATH));
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!isVaultIndex(parsed)) throw new Error("vault index: bad shape");
        if (!cancelled) setCount(journalThisWeek(parsed.notes));
      } catch {
        // any fetch/decrypt failure → the segment simply isn't there
        if (!cancelled) setCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  if (count === null) return null;
  return (
    <>
      {" · "}journal <span className="text-amber">{count}</span>
    </>
  );
}
