"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { APERTURE_CONTEXT } from "@/lib/aevcontext";
import {
  isAttainment,
  normalizeAperture,
  type AperturePath,
  type ApertureDoc,
} from "@/lib/aperture";
import {
  conditionChipClass,
  conditionChipPrefix,
  detailStatus,
  splitTrials,
  trialSchedule,
} from "@/lib/apertureview";

/**
 * ApertureDetail — everything behind the seal, as a client island under the band.
 * The document rides the E2EE layer, so it is fetched as ciphertext and opened in
 * the browser under the master key; the server never sees a streak, a condition or
 * a trial. Sealed dots until the vault is unlocked here (the IDB key cache usually
 * means it already is), and the decrypted document leaves the moment the vault
 * locks.
 *
 * The six states it can be in are `apertureview.detailStatus`, not branches
 * invented here — this file only maps each to markup.
 *
 * UNKNOWN VOCABULARY RENDERS MUTED, ALWAYS. A status, tier, rung or state this
 * build has never heard of is printed as its literal in muted type: never dropped
 * (the module would silently shrink), never styled as though it were understood.
 */

/** One entry of the strike counters, rendered `petitions ×2`. */
function strikeLine(k: string, n: number): string {
  return `${k} ×${n}`;
}

/** The decrypted document plus the instant it landed. The clock is read ONCE, in
 *  the effect, and every countdown below is measured from it: render stays pure,
 *  and a re-render can't silently shift a trial's "in 41d" by a day. */
interface Loaded {
  doc: ApertureDoc;
  at: number;
}

export function ApertureDetail({ offline }: { offline: boolean }) {
  const { status, openItem } = useVault(offline);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  // Render-phase adjustment (not an effect): dropping the decrypted document the
  // moment the vault stops being unlocked, per the lint-blessed reset pattern.
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) {
      setLoaded(null);
      setDataErr(null);
      setShowResolved(false);
    }
  }

  useEffect(() => {
    if (status !== "unlocked") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/aperture");
        if (res.status !== 200) {
          // 404 (nothing synced yet) and 503 (a flaky store) both mean the same
          // thing to this island: no document to show, and not the vault's fault.
          if (!cancelled) setDataErr("unreachable");
          return;
        }
        try {
          const { bytes } = await openItem(
            new Uint8Array(await res.arrayBuffer()),
            APERTURE_CONTEXT,
          );
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          const next = normalizeAperture(parsed);
          // A decrypted-but-malformed document is indistinguishable from tampering
          // at this trust boundary: the AEAD tag already passed, so the bytes are
          // the ones that were sealed — if their SHAPE is wrong, either the seal
          // or what went into it is not what this build trusts. Same red line.
          if (!next) throw new Error("aperture: bad shape");
          if (!cancelled) setLoaded({ doc: next, at: Date.now() });
        } catch {
          if (!cancelled) setDataErr("tamper");
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem]);

  switch (detailStatus(status, dataErr, loaded?.doc ?? null)) {
    case "offline":
      // Store off — the feature is simply absent (DropInbox's precedent). There is
      // no key to want and no door to point at, so pointing at one would be noise.
      return null;

    case "sealed":
      return (
        <p className="mt-1.5 text-xs text-muted">
          <span className="text-muted/40">·····</span> sealed —{" "}
          <Link href="/files" className="text-amber hover:underline">
            unlock in files →
          </Link>
        </p>
      );

    case "decrypting":
      return <p className="mt-1.5 text-xs text-muted">decrypting…</p>;

    case "unreachable":
      return (
        <p className="mt-1.5 text-xs text-down">
          vault unreachable — reload to retry
        </p>
      );

    case "tamper":
      return (
        <p className="mt-1.5 text-xs text-down">
          cannot decrypt — lock and unlock
        </p>
      );
  }

  // `ready` — narrowed by the switch above, but TS can't see it through the helper.
  if (!loaded) return null;
  const { streaks, conditions, paths, vitalGu, trials, breakthrough } =
    loaded.doc.sealed;
  const { open, resolved } = splitTrials(trials);
  const streakEntries = Object.entries(streaks);
  const strikes = Object.entries(breakthrough.recentStrikes);
  const now = loaded.at;

  return (
    <div className="mt-2 flex flex-col gap-2 text-xs">
      {/* The adjudication dot belongs beside the streaks — it says the sealed
          picture is behind the raw journal days. Wiring it needs the newest raw
          day, which today means a second sealed vault-index fetch + decrypt that
          no shared helper exposes (JournalActivityRow and VaultTodayGlance each
          keep their own copy of that pipeline). Left out rather than triplicated;
          a follow-up gives the vault index one hook and lights the dot from it. */}
      {streakEntries.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {streakEntries.map(([name, s]) => (
            <li key={name} className="text-muted">
              <span className="text-fg/90">{name}</span>{" "}
              <span className="tabular-nums text-fg">
                {s.count}/{s.target}
              </span>{" "}
              {s.state}
              {s.earliestHarden && ` → harden ${s.earliestHarden}`}
            </li>
          ))}
        </ul>
      )}

      {conditions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {conditions.map((c, i) => (
            <span
              key={i}
              className={`inline-flex items-baseline gap-1 border px-1.5 py-0.5 ${conditionChipClass(c.status)}`}
            >
              <span>
                {conditionChipPrefix(c.status)}
                {c.label}
              </span>
              <span className="tabular-nums">
                {c.progress}/{c.target} {c.unit}
              </span>
            </span>
          ))}
        </div>
      )}

      {paths.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {paths.map((p, i) => (
            <PathRow key={i} path={p} />
          ))}
        </ul>
      )}

      {vitalGu && (
        <p className="text-muted">
          <span className="text-fg/90">{vitalGu.name}</span> ·{" "}
          <span className="tabular-nums">
            {vitalGu.rank}/{vitalGu.max}
          </span>
        </p>
      )}

      {(open.length > 0 || resolved.length > 0) && (
        <div className="flex flex-col gap-0.5">
          {open.map((t, i) => (
            <p key={i} className="text-muted">
              <span className="text-fg/90">{t.name}</span> · {t.tier} ·{" "}
              {t.state}{" "}
              <span className="tabular-nums">{trialSchedule(t.date, now)}</span>
            </p>
          ))}
          {resolved.length > 0 && !showResolved && (
            <button
              type="button"
              onClick={() => setShowResolved(true)}
              className="self-start text-amber transition-colors hover:underline"
            >
              +{resolved.length} resolved ▸
            </button>
          )}
          {showResolved &&
            resolved.map((t, i) => (
              <p key={i} className="text-muted/70">
                <span>{t.name}</span> · {t.tier} · {t.state}{" "}
                <span className="tabular-nums">
                  {trialSchedule(t.date, now)}
                </span>
              </p>
            ))}
          {showResolved && (
            <button
              type="button"
              onClick={() => setShowResolved(false)}
              className="self-start text-amber transition-colors hover:underline"
            >
              ▴ hide resolved
            </button>
          )}
        </div>
      )}

      <div className="text-muted">
        <p>
          <span className="text-fg/90">{breakthrough.wall}</span>
          {breakthrough.event && ` · ${breakthrough.event}`}
        </p>
        {breakthrough.routes.length > 0 && (
          <ul className="flex flex-col">
            {breakthrough.routes.map((r, i) => (
              <li key={i}>— {r}</li>
            ))}
          </ul>
        )}
        {strikes.length > 0 && (
          <p className="tabular-nums">
            {strikes.map(([k, n]) => strikeLine(k, n)).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

/** One path and its sub-paths. An attainment this build knows reads a shade
 *  brighter; an unknown rung stays the muted literal, never dressed as known. */
function PathRow({ path }: { path: AperturePath }) {
  return (
    <li className="text-muted">
      <span className="text-fg/90">{path.name}</span>
      {path.attainment && (
        <>
          {" "}
          <span
            className={
              isAttainment(path.attainment) ? "text-fg/70" : "text-muted"
            }
          >
            {path.attainment}
            {path.verified && " ✓"}
          </span>
        </>
      )}
      {path.sub && path.sub.length > 0 && (
        <ul className="flex flex-col pl-4">
          {path.sub.map((s, i) => (
            <PathRow key={i} path={s} />
          ))}
        </ul>
      )}
    </li>
  );
}
