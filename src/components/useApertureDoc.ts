"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { APERTURE_CONTEXT, FIN_CONTEXT } from "@/lib/aevcontext";
import { normalizeAperture, type ApertureDoc } from "@/lib/aperture";
import type { EnvelopeMeta } from "@/lib/crypto";
import { normalizeFinConfig, type FinConfig } from "@/lib/fin";

/**
 * useApertureDoc — the two envelopes every inward surface is read from, opened
 * once in the browser: the sealed status document (authoritative) and the fin
 * envelope (a rider). Extracted when the gu compendium became its own page and
 * wanted the identical unlock → fetch → decrypt → normalize walk the inward page
 * already ran; two surfaces opening the same envelope is exactly one copy of this
 * doctrine too many to keep in two files (the `useFinTotals` precedent).
 *
 * THE DOCUMENT IS THE RED LINE. A 404/503 from the store is `unreachable` — there
 * is nothing sealed to look into, and it is not the vault's fault. Decrypted-but-
 * malformed is `tamper`: the AEAD tag passed, so these ARE the sealed bytes, and a
 * shape this build doesn't trust means what went into the seal isn't what came out
 * of the check-in.
 *
 * THE MONEY IS A RIDER, on the `useFinTotals` terms: any miss resolves to null and
 * the caller prints dashes. It fills figures, so it must never hold the document
 * back or be able to fail it. Everything drops the moment the vault locks.
 */
export interface ApertureRead {
  /** The vault machine's status — the caller pairs it with `detailStatus`. */
  status: string;
  /** The opener, so a caller can decrypt its OWN riders off the same key. */
  openItem: (
    envelope: Uint8Array,
    context?: string,
  ) => Promise<{ bytes: Uint8Array }>;
  /** The sealer, for a surface that writes a rider of its own (the gu book's
   *  marks) under the same key. Throws when locked, like the vault's. */
  sealItem: (
    meta: EnvelopeMeta,
    bytes: Uint8Array,
    context?: string,
  ) => Promise<Uint8Array>;
  doc: ApertureDoc | null;
  fin: FinConfig | null;
  dataErr: "unreachable" | "tamper" | null;
}

export function useApertureDoc(offline: boolean): ApertureRead {
  const { status, openItem, sealItem } = useVault(offline);
  const [doc, setDoc] = useState<ApertureDoc | null>(null);
  const [fin, setFin] = useState<FinConfig | null>(null);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);

  // Render-phase adjustment (not an effect): dropping everything decrypted the
  // moment the vault stops being unlocked, per the lint-blessed reset pattern.
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) {
      setDoc(null);
      setFin(null);
      setDataErr(null);
    }
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/aperture");
        if (res.status !== 200) {
          // 404 (nothing sealed yet) and 503 (a flaky store) mean the same thing
          // to a reader: no document to look into, and not the vault's fault.
          if (!cancelled) setDataErr("unreachable");
          return;
        }
        let next: ApertureDoc;
        try {
          const { bytes } = await openItem(
            new Uint8Array(await res.arrayBuffer()),
            APERTURE_CONTEXT,
          );
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          const normalized = normalizeAperture(parsed);
          if (!normalized) throw new Error("aperture: bad shape");
          next = normalized;
        } catch {
          if (!cancelled) setDataErr("tamper");
          return;
        }
        if (!cancelled) setDoc(next);

        // The money rider — best-effort by construction.
        try {
          const finRes = await fetch("/api/fin/config");
          let cfg: FinConfig | null = null;
          if (finRes.status === 200) {
            const { bytes } = await openItem(
              new Uint8Array(await finRes.arrayBuffer()),
              FIN_CONTEXT,
            );
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            cfg = normalizeFinConfig(parsed);
            if (!cfg) throw new Error("fin config: bad shape");
          } else if (finRes.status === 404) {
            // Nothing sealed yet — an empty ledger, not a failure.
            cfg = { v: 2, entries: [], invested: [], portfolio: null };
          } else {
            throw new Error(`fin config: ${finRes.status}`);
          }
          if (!cancelled) setFin(cfg);
        } catch {
          if (!cancelled) setFin(null);
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  return { status, openItem, sealItem, doc, fin, dataErr };
}
