"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import {
  endpointParam,
  fmtSydneyTime,
  glanceSummary,
  leaveBy,
  normalizeTransitConfig,
  shiftTarget,
  tripTitle,
  type GlanceSummary,
  type LeaveBy,
  type TransitTrip,
  type TripResult,
} from "@/lib/transit";
import { TRANSIT_CONTEXT } from "@/lib/aevcontext";

/** Refresh cadence while the tab is visible — departures go stale fast. */
const REFRESH_MS = 60_000;

/**
 * The command center's "next trip" row (roadmap 50): the FIRST saved transit
 * trip collapsed to one live line — depart time, line, platform, delay chip.
 * The saved trips are sealed (ADR 0091), so this is a vault island: sealed
 * dots until the key is in hand, and the endpoint pair goes to the owner-gated
 * proxy per refresh, never stored. Polls every 60s while the tab is visible;
 * a hidden tab spends nothing.
 *
 * Before the shift (`shiftTarget` — 04:00 to 15:00 Sydney) each tick plans
 * twice: "leave now" for the live line, and an arrive-by plan anchored on the
 * shift's arrive-by instant for a second line naming the last run that still
 * makes it. From 15:00 a tick plans once and the second line is gone.
 */
export function TransitGlance({ offline }: { offline: boolean }) {
  const { status, openItem } = useVault(offline);
  const unlocked = status === "unlocked";

  // undefined = still loading the config; null = no saved trips.
  const [trip, setTrip] = useState<TransitTrip | null | undefined>(undefined);
  const [summary, setSummary] = useState<GlanceSummary | null>(null);
  // null = no leave-by line (after the shift, or the arrive-by plan failed).
  const [leave, setLeave] = useState<{
    target: string;
    pick: LeaveBy | null;
  } | null>(null);
  const [sample, setSample] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setTrip(undefined);
    setSummary(null);
    setLeave(null);
    setFailed(false);
  }

  // Decrypt the saved-trips config once per unlock; the first trip is the row.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/transit/config");
        if (res.status === 404) {
          if (!cancelled) setTrip(null);
          return;
        }
        if (res.status !== 200) throw new Error(`config: ${res.status}`);
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
          TRANSIT_CONTEXT,
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const cfg = normalizeTransitConfig(parsed);
        if (!cfg) throw new Error("bad shape");
        if (!cancelled) setTrip(cfg.trips[0] ?? null);
      } catch {
        if (!cancelled) {
          setTrip(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  // Plan the trip now + every REFRESH_MS while visible; refresh on tab return.
  useEffect(() => {
    if (!trip) return;
    let disposed = false;

    // The arrive-by plan for the shift — same tick, same seq guard.
    async function refreshLeave(t: TransitTrip, s: number) {
      const target = shiftTarget(new Date());
      if (!target) {
        setLeave(null);
        return;
      }
      const at = target.toISOString();
      try {
        const qs = new URLSearchParams([
          ["from", endpointParam(t.from)],
          ["to", endpointParam(t.to)],
          ["modes", t.modes],
          ["when", "arr"],
          ["at", at],
        ]);
        const res = await fetch(`/api/transit/trip?${qs}`);
        const data = res.ok
          ? ((await res.json()) as { result?: TripResult })
          : null;
        if (disposed || seq.current !== s) return;
        setLeave(
          data?.result ? { target: at, pick: leaveBy(data.result, at) } : null,
        );
      } catch {
        if (!disposed && seq.current === s) setLeave(null);
      }
    }

    async function refresh() {
      if (!trip || document.visibilityState !== "visible") return;
      const s = ++seq.current;
      void refreshLeave(trip, s);
      try {
        const qs = new URLSearchParams([
          ["from", endpointParam(trip.from)],
          ["to", endpointParam(trip.to)],
          ["modes", trip.modes],
        ]);
        const res = await fetch(`/api/transit/trip?${qs}`);
        if (disposed || seq.current !== s) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const data = (await res.json()) as {
          sample?: boolean;
          result?: TripResult;
        };
        if (disposed || seq.current !== s) return;
        if (!data.result) {
          setFailed(true);
          return;
        }
        setSummary(glanceSummary(data.result));
        setSample(data.sample === true);
        setFailed(false);
      } catch {
        if (!disposed && seq.current === s) setFailed(true);
      }
    }

    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [trip]);

  const link = (
    <Link href="/transit" className="text-amber hover:underline">
      transit/ →
    </Link>
  );

  if (!unlocked)
    return (
      <span className="text-xs text-muted">
        <span className="text-muted/40">·····</span> sealed — {link}
      </span>
    );
  if (trip === undefined)
    return <span className="text-xs text-muted">decrypting…</span>;
  if (trip === null)
    return (
      <span className="text-xs text-muted">
        {failed ? "trips unreachable — " : "no saved trips — "}
        {link}
      </span>
    );
  if (!summary)
    return (
      <span className="text-xs text-muted">
        {failed ? <span className="text-down">planner unreachable</span> : "…"}{" "}
        · {link}
      </span>
    );

  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-semibold tabular-nums text-fg">
          {fmtSydneyTime(summary.depTime)}
        </span>
        {summary.line && (
          <span className="border border-hairline px-1 text-xs text-fg">
            {summary.line}
          </span>
        )}
        {summary.platform && (
          <span className="text-xs text-muted">plat {summary.platform}</span>
        )}
        {summary.cancelled ? (
          <span className="text-xs text-down">✕ cancelled</span>
        ) : summary.delayMin !== null && summary.delayMin > 0 ? (
          <span className="text-xs text-amber">● +{summary.delayMin} min</span>
        ) : summary.live ? (
          <span className="text-xs text-up">● on time</span>
        ) : (
          <span className="text-xs text-muted">○ sched</span>
        )}
        <span className="text-xs text-muted">
          → {fmtSydneyTime(summary.arriveTime)} · {tripTitle(trip)}
        </span>
        {sample && <span className="text-[10px] text-muted/60">sample</span>}
        <span className="text-xs">{link}</span>
      </span>
      {leave &&
        (leave.pick ? (
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted">
            {[
              <span key="dep">
                leave by{" "}
                <span className="font-semibold tabular-nums text-fg">
                  {fmtSydneyTime(leave.pick.depTime)}
                </span>
              </span>,
              leave.pick.line && (
                <span
                  key="line"
                  className="border border-hairline px-1 text-fg"
                >
                  {leave.pick.line}
                </span>
              ),
              leave.pick.platform && (
                <span key="plat">plat {leave.pick.platform}</span>
              ),
              <span key="arr">
                arrives {fmtSydneyTime(leave.pick.arriveTime)}
              </span>,
            ]
              .filter(Boolean)
              .flatMap((part, i) =>
                i === 0 ? [part] : [<span key={`sep${i}`}>·</span>, part],
              )}
          </span>
        ) : (
          <span className="text-xs text-muted">
            no run arrives by {fmtSydneyTime(leave.target)} — leave now
          </span>
        ))}
    </span>
  );
}
