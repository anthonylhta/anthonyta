"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import {
  buildFullSeries,
  investedAt,
  latestEntry,
  normalizeFinConfig,
  monthToDateBaseline,
  sydneyToday,
} from "@/lib/fin";
import { FIN_CONTEXT } from "@/lib/aevcontext";
import { arrow, aud, tone } from "@/lib/money";

/**
 * The command center's net-worth numbers as a small client island — the only part of
 * the TODAY zone that isn't server-rendered (ADR 0054; fully envelope-sourced since
 * ADR 0061). Everything financial — invested, cash/HISA, the month-to-date Δ —
 * rides the E2EE fin layer, so figures only surface once the vault is unlocked in
 * this browser (the IDB key cache usually means it already is). Any miss — offline,
 * locked, a fetch/decrypt hiccup — degrades to placeholder dots: never a crash,
 * never a pretend-zero, and never a figure before the key.
 */

interface Loaded {
  invested: number;
  cash: number;
  hisa: number;
  /** Month-to-date Δ in dollars; null during the first month of data. */
  delta: number | null;
}

export function NetWorthGlance({ offline }: { offline: boolean }) {
  const { status, openItem } = useVault(offline);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // Render-phase adjustment (not an effect): dropping decrypted figures the
  // moment the vault stops being unlocked, per the lint-blessed reset pattern.
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

        // Month-to-date Δ from the step-function series (ADR 0061) — same
        // envelope, no extra round-trips. On weekly pay a 7-day Δ just echoed
        // whether payday had happened yet; "this month" accumulates the
        // paychecks + interest into a number that means saved-so-far.
        let delta: number | null = null;
        const series = buildFullSeries(cfg, today);
        const base = monthToDateBaseline(series, today);
        const latest = series.at(-1);
        if (base && latest) delta = (latest.totalCents - base.totalCents) / 100;

        if (!cancelled) setLoaded({ invested, cash, hisa, delta });
      } catch {
        // any failure in the unlocked path → placeholder fallback
        if (!cancelled) setLoaded(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem]);

  // Unlocked and loaded → the full figure; everything else (offline, locked, error,
  // loading, or still decrypting) → placeholders with a nudge to /portfolio.
  if (status === "unlocked" && loaded) {
    const { invested, cash, hisa, delta } = loaded;
    return (
      <>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-2xl tabular-nums text-fg">
            {aud(invested + cash + hisa)}
          </span>
          {delta !== null && (
            <span className={`text-sm tabular-nums ${tone(delta)}`}>
              {arrow(delta)} {aud(Math.abs(delta))} this month
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs tabular-nums text-muted">
          invested {aud(invested)} · cash {aud(cash)} · hisa {aud(hisa)}
        </p>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl tabular-nums text-muted/40">·····</span>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        sealed —{" "}
        <Link href="/portfolio" className="text-amber hover:underline">
          unlock on portfolio →
        </Link>
      </p>
    </>
  );
}
