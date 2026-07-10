"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { boxOpen, fromB64url, importBoxPriv, isSnapkey } from "@/lib/crypto";
import {
  buildNetWorthSeries,
  isFinConfig,
  isSnapBoxPayload,
  latestEntry,
  pickBaseline,
  sydneyToday,
  type FinConfig,
  type SnapBoxPayload,
} from "@/lib/fin";
import { arrow, aud, tone } from "@/lib/money";

/**
 * The command center's net-worth numbers as a small client island — the only part of
 * the TODAY zone that isn't server-rendered (ADR: sealed net worth). The invested
 * figure is always live; cash/HISA and the week-over-week Δ ride the E2EE fin layer,
 * so they only surface once the vault is unlocked in this browser (the IDB key cache
 * usually means it already is). Any miss — offline, locked, a fetch/decrypt hiccup —
 * degrades to invested-only: never a crash, never a pretend-zero.
 */

interface Loaded {
  cash: number;
  hisa: number;
  /** Week-over-week Δ in dollars; null when history can't reach back a week. */
  delta: number | null;
}

export function NetWorthGlance({
  invested,
  offline,
}: {
  invested: number;
  offline: boolean;
}) {
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
        const [cfgRes, keyRes, snapRes] = await Promise.all([
          fetch("/api/fin/config"),
          fetch("/api/fin/snapkey"),
          fetch("/api/fin/snapshots?days=14"),
        ]);

        // Cash/HISA config: 200 → decrypt + guard; 404 → none set yet (0/0); any
        // other status is a flake — bail to invested-only rather than pretend zero.
        let cfg: FinConfig = { v: 1, entries: [] };
        if (cfgRes.status === 200) {
          const { bytes } = await openItem(
            new Uint8Array(await cfgRes.arrayBuffer()),
          );
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (!isFinConfig(parsed)) throw new Error("fin config: bad shape");
          cfg = parsed;
        } else if (cfgRes.status !== 404) {
          throw new Error(`fin config: ${cfgRes.status}`);
        }
        const entry = latestEntry(cfg);
        const cash = entry?.cash ?? 0;
        const hisa = entry?.hisa ?? 0;

        // Week Δ from the sealed snapshot boxes. Isolated in its own try so a
        // snapkey/box miss only drops the Δ — the figure still renders.
        let delta: number | null = null;
        try {
          if (keyRes.status === 200 && snapRes.status === 200) {
            const key: unknown = JSON.parse(await keyRes.text());
            if (isSnapkey(key)) {
              const pubRaw = fromB64url(key.pub_b64);
              const { bytes: privPkcs8 } = await openItem(
                fromB64url(key.sealed_priv_b64),
              );
              const priv = await importBoxPriv(privPkcs8);
              const { days } = (await snapRes.json()) as {
                days: { date: string; box_b64: string }[];
              };
              const payloads: SnapBoxPayload[] = [];
              for (const d of days) {
                try {
                  const plain = await boxOpen(
                    priv,
                    pubRaw,
                    fromB64url(d.box_b64),
                  );
                  const p: unknown = JSON.parse(
                    new TextDecoder().decode(plain),
                  );
                  if (isSnapBoxPayload(p)) payloads.push(p);
                } catch {
                  // one unreadable box shouldn't sink the whole series
                }
              }
              const series = buildNetWorthSeries(payloads, cfg);
              const base = pickBaseline(series, 7, sydneyToday());
              const latest = series.at(-1);
              if (base && latest)
                delta = (latest.totalCents - base.totalCents) / 100;
            }
          }
        } catch {
          // snapkey/snapshots unavailable → no Δ, figure still renders
        }

        if (!cancelled) setLoaded({ cash, hisa, delta });
      } catch {
        // any failure in the unlocked path → invested-only fallback
        if (!cancelled) setLoaded(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem]);

  // Unlocked and loaded → the full figure; everything else (offline, locked, error,
  // loading, or still decrypting) → invested only with a nudge to /portfolio.
  if (status === "unlocked" && loaded) {
    const { cash, hisa, delta } = loaded;
    return (
      <>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-2xl tabular-nums text-fg">
            {aud(invested + cash + hisa)}
          </span>
          {delta !== null && (
            <span className={`text-sm tabular-nums ${tone(delta)}`}>
              {arrow(delta)} {aud(Math.abs(delta))} this week
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
        <span className="text-2xl tabular-nums text-fg">{aud(invested)}</span>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        invested only —{" "}
        <Link href="/portfolio" className="text-amber hover:underline">
          unlock on portfolio →
        </Link>
      </p>
    </>
  );
}
