"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { FIN_CONTEXT } from "@/lib/aevcontext";
import {
  buildFullSeries,
  investedAt,
  latestEntry,
  monthToDateBaseline,
  normalizeFinConfig,
  sydneyToday,
} from "@/lib/fin";

/**
 * The net-worth figures as a hook — everything financial rides the E2EE fin envelope
 * (ADR 0061), so it is fetched as ciphertext and opened in the browser. Extracted
 * from the old standing net-worth glance when the wealth figure moved INTO the paths
 * band as that path's evidence: two surfaces wanting the same four numbers is
 * exactly one fetch/derive too many to keep in two places (the `useCsvChore`
 * precedent, which reads the same envelope for the import chore).
 *
 * Any miss — offline, locked, a fetch/decrypt hiccup, a bad shape — resolves to
 * `null` totals: never a crash, never a pretend-zero, and never a figure before the
 * key. The caller renders placeholder dots and a nudge.
 */

export interface FinTotals {
  /** invested + cash + hisa, in dollars — the figure the sheet prints. */
  total: number;
  invested: number;
  cash: number;
  hisa: number;
  /** Month-to-date Δ in dollars; null during the first month of data. */
  delta: number | null;
}

export function useFinTotals(offline: boolean): FinTotals | null {
  const { status, openItem } = useVault(offline);
  const [totals, setTotals] = useState<FinTotals | null>(null);

  // Render-phase adjustment (not an effect): dropping decrypted figures the moment
  // the vault stops being unlocked, per the lint-blessed reset pattern.
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) setTotals(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        // 200 → decrypt + normalize; 404 → nothing recorded yet (all zeros); any
        // other status is a flake — bail to placeholders rather than pretend zero.
        const res = await fetch("/api/fin/config");
        let cfg = null;
        if (res.status === 200) {
          const { bytes } = await openItem(
            new Uint8Array(await res.arrayBuffer()),
            FIN_CONTEXT,
          );
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          cfg = normalizeFinConfig(parsed);
          if (!cfg) throw new Error("fin config: bad shape");
        } else if (res.status === 404) {
          cfg = { v: 2 as const, entries: [], invested: [], portfolio: null };
        } else {
          throw new Error(`fin config: ${res.status}`);
        }

        const today = sydneyToday();
        const entry = latestEntry(cfg);
        const invested = investedAt(cfg, today) / 100;
        const cash = entry?.cash ?? 0;
        const hisa = entry?.hisa ?? 0;

        // Month-to-date Δ from the step-function series (ADR 0061) — same envelope,
        // no extra round-trips. On weekly pay a 7-day Δ just echoed whether payday
        // had happened yet; "this month" accumulates the paychecks + interest into a
        // number that means saved-so-far.
        let delta: number | null = null;
        const series = buildFullSeries(cfg, today);
        const base = monthToDateBaseline(series, today);
        const latest = series.at(-1);
        if (base && latest) delta = (latest.totalCents - base.totalCents) / 100;

        if (!cancelled)
          setTotals({
            total: invested + cash + hisa,
            invested,
            cash,
            hisa,
            delta,
          });
      } catch {
        // any failure in the unlocked path → placeholder fallback
        if (!cancelled) setTotals(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  return totals;
}
