"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { LabelDoor } from "@/components/terminal/LabelDoor";
import { FIN_CONTEXT } from "@/lib/aevcontext";
import { normalizeFinConfig, recoveredThisWeek } from "@/lib/fin";

/**
 * NoPayRow — the command center's exception row for the fin ledger: says so when
 * no pay-in has been logged in the trailing 7 days. The weekly burn is derived
 * from the pay (ADR 0185), so a missed pay-in doesn't read as missing — it reads
 * as a cheap, even negative, week. The window is `recoveredThisWeek`'s, the same
 * trailing week the burn uses, never a second definition of it.
 *
 * The WHOLE row is the island, because the ledger is sealed in `meta/fin` and
 * only the browser can read it. Absence of evidence is quiet: locked, loading,
 * no ledger (a 404 is nothing to nag about), any failure, or a pay-in inside the
 * window → the row isn't there. It never nags on a locked vault.
 */
export function NoPayRow({
  offline,
  today,
}: {
  offline: boolean;
  today: string;
}) {
  const { status, openItem } = useVault(offline);
  const unlocked = status === "unlocked";
  const [missing, setMissing] = useState(false);

  // Render-phase reset on the lock edge (the WaitingOnRow idiom): what the
  // ledger said leaves with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setMissing(false);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fin/config");
        if (res.status !== 200) return; // 404 = no ledger yet; else quiet
        const envelope = new Uint8Array(await res.arrayBuffer());
        const { bytes } = await openItem(envelope, FIN_CONTEXT);
        const cfg = normalizeFinConfig(
          JSON.parse(new TextDecoder().decode(bytes)),
        );
        if (cfg && !cancelled)
          setMissing(recoveredThisWeek(cfg, today) === null);
      } catch {
        // any fetch/decrypt failure → the row simply isn't there
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem, today]);

  if (!unlocked || !missing) return null;
  return (
    <div className="flex items-baseline gap-3 border-t border-hairline px-4 py-2.5 text-sm">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em]">
        <LabelDoor href="/portfolio" label="pay" />
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span className="text-fg">no pay-in logged in the last </span>
        <span className="tabular-nums text-amber">7 days</span>
        <span className="hidden text-muted sm:inline">
          {" "}
          · ⌘K pay &lt;amount&gt;
        </span>
      </span>
    </div>
  );
}
