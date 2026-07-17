"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { CHORE_CADENCE_DAYS, choreState } from "@/lib/chores";
import { normalizeFinConfig } from "@/lib/fin";
import { ChoreChip } from "./ChoreChip";

/**
 * The CSV-import chore chip (roadmap 52) — its evidence is the newest
 * invested[] date inside the E2EE fin envelope, so unlike its two server-side
 * siblings this chip decrypts in the browser. Sealed dots until the key is in
 * hand; any miss reads as "no record", never an error.
 */
export function ChoreCsvChip({ offline }: { offline: boolean }) {
  const { status, openItem } = useVault(offline);
  const unlocked = status === "unlocked";
  const [lastImport, setLastImport] = useState<string | null>(null);

  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setLastImport(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fin/config");
        if (res.status !== 200) return;
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const cfg = normalizeFinConfig(parsed);
        if (!cfg) return;
        // YYYY-MM-DD sorts lexically — the max is the newest import.
        const latest = cfg.invested.reduce<string | null>(
          (max, e) => (max === null || e.date > max ? e.date : max),
          null,
        );
        if (!cancelled) setLastImport(latest);
      } catch {
        // sealed/failed → stays "no record"
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  if (!unlocked)
    return <span className="text-xs text-muted/50">csv import ·····</span>;

  return (
    <ChoreChip
      label="csv import"
      state={choreState(lastImport, CHORE_CADENCE_DAYS.csv, new Date())}
    />
  );
}
