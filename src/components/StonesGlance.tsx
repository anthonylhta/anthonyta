"use client";

import Link from "next/link";
import { useFinTotals } from "@/components/useFinTotals";
import { audCompact } from "@/lib/money";

/** Weeks in a year, for turning a weekly burn into a foundation read in years —
 *  the same arithmetic /aperture prints in months, at the width of one row. */
const WEEKS_PER_YEAR = 52;

/**
 * The stones, as one command-center row: what's liquid, and how long the
 * foundation holds without another dollar coming in. A SECOND reader of the fin
 * envelope alongside the paths band's wealth figure — one hook, so both read the
 * same four numbers off one fetch and one decrypt.
 *
 * It divides, it does not judge. Both figures were typed by the owner and sealed;
 * a runway is arithmetic over them, never a verdict about them (the /aperture
 * doctrine, at a glance's width).
 *
 * Locked, unreachable, or a shape this build doesn't know: the sealed dots. A
 * glance never puts an error on the homepage.
 */
export function StonesGlance({ offline }: { offline: boolean }) {
  const totals = useFinTotals(offline);

  // Store off — there is no envelope to read, so the row says nothing at all
  // rather than dressing an absent store as a locked one.
  if (offline) return null;
  if (!totals) return <span className="text-muted/40">···</span>;

  const liquid = totals.cash + totals.hisa;
  // No declared burn, no runway: the segment goes, rather than dividing by a
  // number nobody gave and printing a confident "0.0y".
  const years =
    totals.burnWeeklyCents === null
      ? null
      : totals.invested / ((totals.burnWeeklyCents / 100) * WEEKS_PER_YEAR);

  return (
    <Link
      href="/aperture"
      className="group inline-flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums"
    >
      <span className="text-fg">{audCompact(liquid)}</span>
      {years !== null && (
        <>
          <span className="text-muted/40">·</span>
          <span className="text-muted">
            foundation <span className="text-fg/80">{years.toFixed(1)}y</span>
          </span>
        </>
      )}
      <span className="text-muted/40">·</span>
      <span className="text-muted group-hover:text-amber">aperture →</span>
    </Link>
  );
}
