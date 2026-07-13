"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { normalizeFinConfig } from "@/lib/fin";
import { matchBriefing, type RelevanceHit } from "@/lib/relevance";
import type { Briefing } from "@/lib/sampleBriefing";

/**
 * BriefingRelevance — the owner-only "relevant to you" annotation on the briefing,
 * computed entirely in the browser (roadmap item 35 Phase B). The holding codes ride
 * the E2EE fin envelope, so the match only runs once the vault is unlocked in this
 * browser; the server holds the briefing, the browser holds the holdings, and only
 * here do the two ever meet.
 *
 * This is an annotation, not a data row: any miss — offline, locked, no holdings, no
 * matches, a fetch/decrypt hiccup — renders NOTHING. It only ever mounts inside an
 * owner-gated tree, so "nothing" is the right absence, not a teaser. Mirrors
 * NetWorthGlance's unlock lifecycle and its render-phase reset-on-lock exactly.
 */

export function BriefingRelevance({
  briefing,
  offline,
}: {
  briefing: Briefing;
  offline: boolean;
}) {
  const { status, openItem } = useVault(offline);
  const [hits, setHits] = useState<RelevanceHit[]>([]);

  // Render-phase adjustment (not an effect): drop the matches the moment the vault
  // stops being unlocked, per the lint-blessed reset pattern (NetWorthGlance/FinPanel).
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) setHits([]);
  }

  useEffect(() => {
    if (status !== "unlocked") return;
    let cancelled = false;
    (async () => {
      try {
        // 200 → decrypt + normalize → holding codes; anything else (404 first run,
        // or a flake) → no annotation. Never guess, never a placeholder row.
        const res = await fetch("/api/fin/config");
        if (res.status !== 200) {
          if (!cancelled) setHits([]);
          return;
        }
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const cfg = normalizeFinConfig(parsed);
        const codes = cfg?.portfolio?.holdings.map((h) => h.code) ?? [];
        if (!cancelled) setHits(matchBriefing(briefing, codes));
      } catch {
        // any failure in the unlocked path → no annotation, never a crash
        if (!cancelled) setHits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem, briefing]);

  if (!unlocked || hits.length === 0) return null;

  return (
    <div className="mt-3 border-t border-hairline/40 pt-3">
      <p className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
        relevant to you
      </p>
      <ul className="space-y-1 text-xs">
        {hits.slice(0, 6).map((h) => (
          <li key={h.code} className="flex items-baseline gap-1.5">
            <span className="text-amber">{h.code}</span>
            <span className="text-muted">
              · {h.hits.length} {h.hits.length === 1 ? "mention" : "mentions"} ·{" "}
              {h.hits[0].where}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
