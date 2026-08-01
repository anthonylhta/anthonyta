"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { MEALS_CONTEXT } from "@/lib/aevcontext";
import {
  dayTotals,
  EMPTY_MEALS_CONFIG,
  normalizeMealsConfig,
  type MealsConfig,
  type MealsTargets,
} from "@/lib/meals";
import { commas } from "@/lib/steps";

/** Protein first and accented; the rest are context. */
const MINI: { key: keyof MealsTargets; label: string }[] = [
  { key: "p", label: "p" },
  { key: "kcal", label: "kcal" },
  { key: "c", label: "c" },
  { key: "f", label: "f" },
];

/**
 * The day's macros as one command-center row — four short tracks and the protein
 * figure, jumping to /meals. A SECOND reader of the `meta/meals` envelope: it
 * never writes, so there is no seq check here (the full page owns that, along
 * with the honest error states). Any miss — locked, unreachable, a shape this
 * build doesn't know — renders the sealed dots; a glance never puts an error on
 * the homepage.
 */
export function MealsGlance({
  offline,
  today,
}: {
  offline: boolean;
  today: string;
}) {
  const { status, openItem } = useVault(offline);
  const unlocked = status === "unlocked";
  const [cfg, setCfg] = useState<MealsConfig | null>(null);

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // readings leave with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/meals");
        if (res.status === 404) {
          if (!cancelled) setCfg(EMPTY_MEALS_CONFIG);
          return;
        }
        if (res.status !== 200) throw new Error(`meals: ${res.status}`);
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
          MEALS_CONTEXT,
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const config = normalizeMealsConfig(parsed);
        if (!config) throw new Error("meals: bad shape");
        if (!cancelled) setCfg(config);
      } catch {
        if (!cancelled) setCfg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  if (!cfg) return <span className="text-muted/40">···</span>;

  const totals = dayTotals(cfg, today);
  const targets = cfg.targets ?? null;

  return (
    <Link
      href="/meals"
      className="group flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
    >
      {targets ? (
        <>
          {MINI.map((m) => (
            <span key={m.key} className="flex items-center gap-1">
              <span className="text-muted/70 group-hover:text-amber">
                {m.label}
              </span>
              <span className="h-1 w-16 bg-surface">
                <span
                  className={`block h-full ${
                    m.key === "p" ? "bg-amber" : "bg-fg/30"
                  }`}
                  style={{
                    width: `${fill(totals[m.key], targets[m.key])}%`,
                  }}
                />
              </span>
            </span>
          ))}
          <span className="tabular-nums text-muted">
            p {Math.round(totals.p)}/{Math.round(targets.p)}
          </span>
        </>
      ) : (
        <span className="tabular-nums text-muted group-hover:text-amber">
          p {Math.round(totals.p)}g · {commas(Math.round(totals.kcal))} kcal
        </span>
      )}
    </Link>
  );
}

function fill(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, (value / target) * 100);
}
