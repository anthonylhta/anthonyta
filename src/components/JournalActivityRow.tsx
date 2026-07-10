"use client";

import { useEffect, useState } from "react";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { useVault } from "@/app/files/useVault";
import { ACTIVITY_DAYS, dailyCounts, toLevels } from "@/lib/activity";
import { isVaultIndex, VAULT_INDEX_PATH } from "@/lib/vaultblob";

/**
 * JournalActivityRow — the command center's THIS-WEEK journal row as a client island
 * (the last row of the zone). The this-week count + ~10-week trend come from the
 * sealed vault index, so they decrypt in the browser (only while unlocked) rather than
 * server-side. Any miss — offline, locked, a fetch/decrypt hiccup — degrades to the
 * reading row's "tracking…" fallback over an empty strip, never a crash. Same row
 * markup the server <ActivityRow> produced for the final (borderless) row.
 */

interface Loaded {
  count: number;
  levels: number[];
}

/** A zero-level strip the width of the trend window, for the not-unlocked fallback. */
const EMPTY_LEVELS = Array<number>(ACTIVITY_DAYS).fill(0);

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

export function JournalActivityRow({
  offline,
  today,
}: {
  offline: boolean;
  today: string;
}) {
  const { status, openItem } = useVault(offline);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // Render-phase reset: drop the decrypted figures the moment the vault stops being
  // unlocked, per the lint-blessed reset pattern (NetWorthGlance/FinPanel).
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) setLoaded(null);
  }

  useEffect(() => {
    if (status !== "unlocked") return;
    let cancelled = false;
    (async () => {
      try {
        const { bytes } = await openItem(await fetchRaw(VAULT_INDEX_PATH));
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!isVaultIndex(parsed)) throw new Error("vault index: bad shape");
        const modified = parsed.notes.map((n) => n.modified);
        if (!cancelled)
          setLoaded({
            count: journalThisWeek(parsed.notes),
            levels: toLevels(dailyCounts(modified, ACTIVITY_DAYS, today)),
          });
      } catch {
        // any fetch/decrypt failure → the "tracking…" fallback, never a crash
        if (!cancelled) setLoaded(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem, today]);

  const value =
    unlocked && loaded ? (
      <span>
        <span className="text-amber">{loaded.count}</span> notes
      </span>
    ) : (
      <span className="text-muted">tracking…</span>
    );
  const levels = unlocked && loaded ? loaded.levels : EMPTY_LEVELS;

  // The final THIS-WEEK row → no bottom border (the old <ActivityRow last />).
  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
        journal
      </span>
      <span className="w-24 shrink-0 tabular-nums text-fg/90">{value}</span>
      <span className="min-w-0 flex-1">
        <ActivityStrip levels={levels} />
      </span>
    </div>
  );
}
