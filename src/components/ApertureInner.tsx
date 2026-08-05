"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useVault } from "@/app/files/useVault";
import { APERTURE_CONTEXT, FIN_CONTEXT } from "@/lib/aevcontext";
import {
  isAttainment,
  normalizeAperture,
  type AperturePath,
  type ApertureDoc,
  type ApertureGu,
  type ApertureVitalGu,
} from "@/lib/aperture";
import { detailStatus } from "@/lib/apertureview";
import {
  absorbedThisWeek,
  investedAt,
  latestEntry,
  normalizeFinConfig,
  recoveredThisWeek,
  sydneyToday,
  type FinConfig,
} from "@/lib/fin";
import { aud } from "@/lib/money";

/**
 * ApertureInner — the inward look, as ONE client island: the sealed status document
 * and the sealed fin envelope, opened together in the browser and read side by side.
 * The server never holds either, so everything below the essence header is drawn
 * from bytes only this device can decrypt, and it all leaves again the moment the
 * vault locks.
 *
 * TWO ENVELOPES, ONE ISLAND, for the same reason GuideSealed keeps four bands in
 * one: the stones, the foundation and the gu are one reading, and splitting them
 * would mean fetching and decrypting the same two blobs twice for one page.
 *
 * The document is authoritative and the money is a rider. A status document that
 * won't open is the page's red line (`tamper`, exactly as on the sheet); a fin
 * envelope that won't open is a figure this page can't print, so those four numbers
 * read as dashes and the gu sections carry on — the `useFinTotals` doctrine, where
 * any miss resolves to null rather than a pretend zero.
 *
 * It ADJUDICATES NOTHING. Every rank, rung and gu was decided at the weekly
 * check-in and sealed; the arithmetic here is division (a runway, a rate) over
 * figures the owner typed, never a judgement about them.
 */

/** The vital gu's five rungs, in order — the ladder is fixed, the slot's rank
 *  is data. Static literals, so the chips can be coloured by index alone. */
const GRADE_LADDER: readonly string[] = [
  "1 shipped",
  "2 first revenue",
  "3 recurring",
  "4 survives unrescued",
  "5 sustains the life",
];

/** Weeks in a month, for turning a weekly burn into a runway a person reads in
 *  months. The average, not 4 — a 4-week month would flatter the number. */
const WEEKS_PER_MONTH = 52 / 12;

/** A figure in cents as the page prints it, or the honest dash. Null means "not
 *  knowable here" — never a zero the page made up. */
function cents(v: number | null): string {
  return v === null ? "—" : aud(v / 100);
}

/** A path's card id, so the sheet's path rows can link straight at it (#craft). */
function anchor(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export function ApertureInner({ offline }: { offline: boolean }) {
  const { status, openItem } = useVault(offline);
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
    if (status !== "unlocked") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/aperture");
        if (res.status !== 200) {
          // 404 (nothing sealed yet) and 503 (a flaky store) mean the same thing
          // to this page: no document to look into, and not the vault's fault.
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
          // Decrypted-but-malformed is indistinguishable from tampering at this
          // boundary: the AEAD tag passed, so these ARE the sealed bytes — if
          // their shape is wrong, what went into the seal is not what this build
          // trusts. Same red line the sheet draws.
          if (!normalized) throw new Error("aperture: bad shape");
          next = normalized;
        } catch {
          if (!cancelled) setDataErr("tamper");
          return;
        }
        if (!cancelled) setDoc(next);

        // The money rider — best-effort by construction. It only fills four
        // figures, so it must never hold the document back or be able to fail it.
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
  }, [status, openItem]);

  switch (detailStatus(status, dataErr, doc)) {
    case "offline":
      return <StatusLine>store offline — set the R2_* env vars</StatusLine>;

    case "sealed":
      // The whole page is behind the key, so the seal IS the page: one stamp, one
      // line, and no list of what is being withheld — naming it would be the
      // reading itself.
      return (
        <div className="flex flex-col items-center gap-3 border-t border-hairline px-4 py-12">
          <span
            aria-hidden
            lang="zh"
            className="skin-stamp h-16 w-16 -rotate-6 border-[3px] text-[38px] opacity-75"
          >
            封
          </span>
          <p className="text-xs text-muted">
            sealed — unlock on the sheet to look inward
          </p>
        </div>
      );

    case "decrypting":
      return (
        <p className="border-t border-hairline px-4 py-6 text-xs text-muted">
          decrypting…
        </p>
      );

    case "unreachable":
      return <StatusLine>vault unreachable — reload to retry</StatusLine>;

    case "tamper":
      return <StatusLine>cannot decrypt — lock and unlock</StatusLine>;
  }

  // `ready` — narrowed by the switch above, but TS can't see it through the helper.
  if (!doc) return null;
  const { paths, vitalGu, rented } = doc.sealed;

  const today = sydneyToday();
  const recovered = fin ? recoveredThisWeek(fin, today) : null;
  const absorbed = fin ? absorbedThisWeek(fin, today) : null;
  const entry = fin ? latestEntry(fin) : null;
  // Cash and HISA are dollars in the envelope; every figure on this page is cents.
  const stones = fin
    ? Math.round(((entry?.cash ?? 0) + (entry?.hisa ?? 0)) * 100)
    : null;
  const invested = fin ? investedAt(fin, today) : null;
  const burn = fin?.burnWeeklyCents ?? null;

  // What share of the week's pay was put away. Only when both ends are real —
  // a rate over a week with no logged pay would be arithmetic about nothing.
  const rate =
    absorbed !== null && recovered !== null && recovered > 0
      ? Math.round((absorbed / recovered) * 100)
      : null;
  const runway =
    stones !== null && burn !== null
      ? `${(stones / burn / WEEKS_PER_MONTH).toFixed(1)} mo`
      : "—";
  const foundationYears =
    invested !== null && burn !== null
      ? `= ${(invested / (burn * 52)).toFixed(1)} y of burn`
      : "= —";

  return (
    <>
      <Section label="primeval stones">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat
            label="recovered this wk"
            value={cents(recovered)}
            tone="text-(--essence)"
          />
          <Stat
            label="absorbed"
            value={`${cents(absorbed)}${rate === null ? "" : ` · ${rate}%`}`}
            // Green says "put away"; a dash has nothing to be green about.
            tone={absorbed === null ? undefined : "text-up"}
          />
          <Stat
            label="stones held"
            value={cents(stones)}
            tone="text-(--essence)"
          />
          <Stat label="runway" value={runway} />
        </div>
        <Flavor>
          mortal economics — stones earned, not produced. denominator ruled,
          re-read quarterly — not measured.
        </Flavor>
      </Section>

      <Section label="the foundation">
        <p className="text-sm tabular-nums">
          <span className="text-(--essence)">{cents(invested)}</span>{" "}
          <span className="text-muted">{foundationYears}</span>
        </p>
        <p className="mt-1 text-[11px] text-muted/60">
          produces: not yet measured
        </p>
        <Flavor>
          the proto-blessed-land — what ascension turns into the land that
          produces.
        </Flavor>
      </Section>

      <Section label="vital gu">
        <VitalGuSlot gu={vitalGu} />
      </Section>

      <Section label="paths · gu held">
        <div className="flex flex-col gap-2.5">
          {paths.map((p, i) => (
            <PathCard key={i} path={p} />
          ))}
        </div>
      </Section>

      {rented && rented.length > 0 && (
        <p className="px-4 pb-4 text-[11px] text-muted">
          rented · {rented.join(" · ")}
        </p>
      )}
    </>
  );
}

/** One bordered band of the page, labelled in the panel register the finance
 *  page reads in — this is a reading, not a dashboard of modules. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-hairline px-4 py-4">
      <p className="mb-2.5 text-[11px] uppercase tracking-[0.2em] text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

/** One figure with its caption — the stones band's unit of reading. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted">
        {label}
      </p>
      <p className={`mt-0.5 text-sm tabular-nums ${tone ?? "text-fg/90"}`}>
        {value}
      </p>
    </div>
  );
}

/** A band's closing line: what the numbers above it MEAN, in the framework's own
 *  register. Muted and italic, so it never competes with a figure. */
function Flavor({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11px] italic text-muted/60">{children}</p>;
}

/** A one-line failure, in the one colour a failure is allowed. */
function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-hairline px-4 py-3 text-xs text-down">
      {children}
    </p>
  );
}

/** The vital gu slot: a name or the honest `unnamed`, its rung on the fixed
 *  ladder, and — while the slot is open — what is being weighed for it. The
 *  dashed border is the slot itself: something that has a shape but no occupant. */
function VitalGuSlot({ gu }: { gu?: ApertureVitalGu }) {
  const named = gu !== undefined && gu.name !== "";
  const rank = gu?.rank ?? 0;
  return (
    <div className="border border-dashed border-hairline px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span
          className={`text-sm ${named ? "text-(--essence)" : "text-muted"}`}
        >
          {named ? gu.name : "unnamed"}
        </span>
        {named && (
          <span className="text-xs tabular-nums text-muted">
            {gu.rank}/{gu.max}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {GRADE_LADDER.map((step, i) => (
          <span
            key={step}
            className={`border px-1.5 py-0.5 text-[10px] ${
              i + 1 <= rank
                ? "border-(--essence) text-(--essence)"
                : "border-hairline text-muted"
            }`}
          >
            {step}
          </span>
        ))}
      </div>
      {gu?.candidates && gu.candidates.length > 0 && (
        <p className="mt-2.5 text-[11px] text-muted">
          candidates: {gu.candidates.join(" · ")}
        </p>
      )}
    </div>
  );
}

/** One top-level path: what it is, what it holds, and what the next rung asks
 *  for. A path with neither gu nor a next line renders as its header alone —
 *  the pre-emission state, shown honestly rather than hidden. */
function PathCard({ path }: { path: AperturePath }) {
  return (
    <div id={anchor(path.name)} className="border border-hairline px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-fg/90">
          {path.name}
          {path.role && (
            <span className="text-[11px] text-muted/60"> {path.role}</span>
          )}
        </span>
        {path.attainment && (
          <span
            className={`text-xs ${
              isAttainment(path.attainment) ? "text-(--essence)" : "text-muted"
            }`}
          >
            {path.attainment}
            {path.verified && <span className="text-up"> ✓</span>}
          </span>
        )}
      </div>
      <GuList gu={path.gu} />
      <NextLine next={path.next} />
      {path.sub?.map((s, i) => (
        <SubPath key={i} path={s} />
      ))}
    </div>
  );
}

/** A sub-path inside its parent's card — its own gu and next rung under a small
 *  indented header. Recursive, so a deeper sub is indented again rather than
 *  silently dropped; the evidence strips stay on the sheet, where the numbers are. */
function SubPath({ path }: { path: AperturePath }) {
  return (
    <div className="mt-2.5 border-t border-hairline/40 pl-3 pt-2">
      <p className="text-[11px] uppercase tracking-[0.15em] text-muted/70">
        {path.name}
      </p>
      <GuList gu={path.gu} />
      <NextLine next={path.next} />
      {path.sub?.map((s, i) => (
        <SubPath key={i} path={s} />
      ))}
    </div>
  );
}

/** The gu a path holds. The one that BEARS the attainment is inked; the rest are
 *  held, which the dot says by staying quiet. */
function GuList({ gu }: { gu?: ApertureGu[] }) {
  if (!gu || gu.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {gu.map((g, i) => (
        <p key={i} className="text-xs">
          <span
            aria-hidden
            className={g.bears ? "text-(--essence)" : "text-muted/40"}
          >
            ●{" "}
          </span>
          <span className="text-fg/90">{g.name}</span>
          {g.type && <span className="text-muted"> — {g.type}</span>}
        </p>
      ))}
    </div>
  );
}

/** What the next rung asks for — the requirement brighter than the label, since
 *  the label is the same three characters on every card. */
function NextLine({ next }: { next?: string }) {
  if (next === undefined || next === "") return null;
  return (
    <p className="mt-2 text-[11px] text-muted">
      next — <span className="text-fg/80">{next}</span>
    </p>
  );
}
