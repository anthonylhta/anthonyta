"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { BreakthroughMoment } from "@/components/BreakthroughMoment";
import { useFinTotals } from "@/components/useFinTotals";
import { APERTURE_CONTEXT } from "@/lib/aevcontext";
import { normalizeAperture, type ApertureProfile } from "@/lib/aperture";
import { ageOn } from "@/lib/apertureview";
import { audCompact } from "@/lib/money";
import type { RiQuote } from "@/lib/quotes";

/**
 * MeSealed — the me-block: who this page belongs to, what he is doing, what he is
 * worth, and the door inward. It is the head of the private home page and NOT a
 * layout unit — identity isn't a module to be reordered away from the top.
 *
 * It draws the WHOLE block rather than only the sealed parts, and deliberately: the
 * age sits mid-sentence in the meta line and the net worth mid-sentence in the line
 * under it, so splitting the block along the seal would mean two components (two
 * `useVault`s, two fetches, two decrypts) interleaving fragments of the same three
 * lines. Everything the server knows — the name, the rank word, the day's quote —
 * arrives as a prop and is rendered on the server exactly as before; only the two
 * figures behind the key are filled in the browser.
 *
 * WARM TERMINAL ONLY. Nothing here wears the essence: the rank is a muted lowercase
 * word, the quote is muted italic, the door is muted until hover. The one sanctioned
 * exception is `BreakthroughMoment`, which fires once per rank or stage change and
 * is the whole point of the palette existing on this page at all.
 *
 * States, in the register a glance is allowed: store off → the sealed slots simply
 * aren't there (the DropInbox precedent — no key to want, no door to point at);
 * locked, unreachable, tampered, or a document with no profile → the same quiet
 * dots. A me-block NEVER shows an error; /aperture owns the error states, because
 * that is the page you go to when you want to know why.
 */

/** What the sealed slots read as before the key is in — dots, never a zero and
 *  never a complaint. */
const AGE_DOTS = "—";
const NOW_DOTS = "····";
const WORTH_DOTS = "$····";

export function MeSealed({
  offline,
  name,
  rankWord,
  quote,
  glance,
  today,
}: {
  offline: boolean;
  /** The public name — the same one the lobby carries. */
  name: string;
  /** The essence colour's name, lowercased, or null off the canon / with no seal. */
  rankWord: string | null;
  /** The day's line, already chosen on the server from the plaintext rank. */
  quote: RiQuote | null;
  /** Rank and stage off the plaintext glance — the flourish's only input. */
  glance: { rank: number; stage: string } | null;
  /** The Sydney calendar day, anchored once on the server so the age and the
   *  quote can never disagree about which day it is. */
  today: string;
}) {
  const { status, openItem } = useVault(offline);
  const totals = useFinTotals(offline);
  const [profile, setProfile] = useState<ApertureProfile | null>(null);

  // Render-phase adjustment (not an effect): dropping the decrypted profile the
  // moment the vault stops being unlocked, per the lint-blessed reset pattern.
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) setProfile(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/aperture");
        if (res.status !== 200) throw new Error(`aperture: ${res.status}`);
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
          APERTURE_CONTEXT,
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const doc = normalizeAperture(parsed);
        if (!doc) throw new Error("aperture: bad shape");
        if (!cancelled) setProfile(doc.sealed.profile ?? null);
      } catch {
        // Nothing synced, a store flake, a shape this build doesn't trust — all
        // the same thing to a glance: the dots stay, and the page says no more.
        if (!cancelled) setProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  const age = profile?.born ? ageOn(profile.born, today) : null;

  // The meta line, as segments — built rather than interpolated so a missing one
  // takes its separator with it and the line never trails a dangling "·".
  const meta: string[] = [];
  if (!offline) meta.push(age === null ? AGE_DOTS : `${age}`);
  meta.push("sydney");
  if (rankWord) meta.push(rankWord);

  return (
    <div className="border-b border-hairline px-4 py-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
        <p className="text-xl leading-tight text-fg">{name}</p>
        <p className="text-xs text-muted">{meta.join(" · ")}</p>
      </div>

      {/* what is being done at the moment, in the check-in's own words */}
      {!offline && (
        <p className="mt-2 text-sm">
          <span className="text-muted">now:</span>{" "}
          {profile?.now ? (
            <span className="text-fg/90">{profile.now}</span>
          ) : (
            <span className="text-muted/40">{NOW_DOTS}</span>
          )}
        </p>
      )}

      {/* what it all adds up to, and the way inward. The figure is the fin
          envelope's, decrypted here; the door beside it is the only route from
          this page into the full reading. */}
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        {!offline && (
          <>
            {totals ? (
              <span className="tabular-nums text-fg">
                {audCompact(totals.total)}
              </span>
            ) : (
              <span className="tabular-nums text-muted/40">{WORTH_DOTS}</span>
            )}
            <span className="text-muted/40">·</span>
          </>
        )}
        <Link
          href="/aperture"
          className="text-muted transition-colors hover:text-amber"
        >
          aperture →
        </Link>
      </p>

      {quote && (
        <p className="mt-2.5 text-xs italic text-muted">“{quote.text}”</p>
      )}

      {/* the breakthrough flourish — silent on every load but the first after a
          rank or a stage moved (roadmap 70a). The one place the essence palette
          is still allowed on this page, and only for a moment. */}
      {glance && <BreakthroughMoment rank={glance.rank} stage={glance.stage} />}
    </div>
  );
}
