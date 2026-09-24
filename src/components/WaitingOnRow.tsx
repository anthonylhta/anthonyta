"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { LabelDoor } from "@/components/terminal/LabelDoor";
import { JOBS_CONTEXT } from "@/lib/aevcontext";
import { normalizeJobsConfig, waitingOn, type WaitingOn } from "@/lib/jobs";

/** Rows shown before the rest fold into `+N more`. */
const MAX_ROWS = 3;

/**
 * WaitingOnRow — the command center's exception row for the application ledger:
 * the open applications quiet past QUIET_DAYS, longest wait first. The WHOLE row
 * is the island, because the ledger is sealed in `meta/jobs` and only the browser
 * can read it — the server can't decide the row's absence, so the island does.
 *
 * Absence of evidence is quiet: locked, loading, no ledger, any failure, or
 * nothing quiet → the row isn't there. It never nags on a locked vault.
 */
export function WaitingOnRow({
  offline,
  today,
}: {
  offline: boolean;
  today: string;
}) {
  const { status, openItem } = useVault(offline);
  const unlocked = status === "unlocked";
  const [items, setItems] = useState<WaitingOn[] | null>(null);

  // Render-phase reset on the lock edge (the JobsLog idiom): the decrypted
  // names leave with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setItems(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/jobs");
        if (res.status !== 200) return; // 404 = no ledger yet; else quiet
        const envelope = new Uint8Array(await res.arrayBuffer());
        const { bytes } = await openItem(envelope, JOBS_CONTEXT);
        const cfg = normalizeJobsConfig(
          JSON.parse(new TextDecoder().decode(bytes)),
        );
        if (cfg && !cancelled) setItems(waitingOn(cfg.apps, today));
      } catch {
        // any fetch/decrypt failure → the row simply isn't there
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem, today]);

  if (!unlocked || items === null || items.length === 0) return null;
  const more = items.length - MAX_ROWS;
  return (
    <div className="flex items-baseline gap-3 border-t border-hairline px-4 py-2.5 text-sm">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em]">
        <LabelDoor href="/jobs" label="jobs" />
      </span>
      <span className="min-w-0 flex-1 text-xs">
        {items.slice(0, MAX_ROWS).map((w) => (
          <span key={`${w.company}-${w.kind}-${w.days}`} className="block">
            <span className="break-words text-fg">{w.company}</span>
            <span className="text-muted"> · {w.kind} · </span>
            <span className="tabular-nums text-amber">{w.days}d</span>
          </span>
        ))}
        {more > 0 && <span className="block text-muted">+{more} more</span>}
      </span>
    </div>
  );
}
