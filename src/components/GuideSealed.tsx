"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { useFinTotals, type FinTotals } from "@/components/useFinTotals";
import { ACTIVITY_DAYS, toLevels } from "@/lib/activity";
import { APERTURE_CONTEXT, GYM_CONTEXT } from "@/lib/aevcontext";
import {
  isAdjudicationPending,
  isAttainment,
  normalizeAperture,
  type AperturePath,
  type ApertureDoc,
} from "@/lib/aperture";
import {
  conditionChipClass,
  conditionChipPrefix,
  conditionStatusWord,
  conditionsSummary,
  declaredSeriesKeys,
  detailStatus,
  isImminent,
  latestDailyDay,
  pathEvidence,
  signedCount,
  splitTrials,
  trialCountdown,
  trialsSummary,
} from "@/lib/apertureview";
import { normalizeGymConfig, sessionCounts, sessionsThisWeek } from "@/lib/gym";
import { arrow, aud, tone } from "@/lib/money";
import { commas } from "@/lib/steps";
import { isVaultIndex, VAULT_INDEX_PATH } from "@/lib/vaultblob";

/**
 * GuideSealed — everything behind the seal, as ONE client island: one fetch of the
 * sealed document, one decrypt, one normalize, and every band of the sheet rendered
 * from it. The document rides the E2EE layer, so the server never sees a streak, a
 * condition or a trial; sealed dots until the vault is unlocked in this browser (the
 * IDB key cache usually means it already is), and the decrypted document leaves the
 * moment the vault locks.
 *
 * ONE island for four bands is the whole point. The wall, the conditions, the paths
 * and the trials all live in the same envelope, so splitting them into a component
 * each would mean four fetches and four decrypts of the same bytes for one page.
 *
 * IT STILL OBEYS THE REGISTRY. `sections` is the visible aperture unit keys in the
 * owner's configured order (computed server-side from lib/layout), and this island
 * renders exactly those, in exactly that order. Hiding a band in /system hides it
 * here; reordering it there reorders it here. The island decides nothing about which
 * bands exist — it only knows how to draw each one.
 *
 * The six states it can be in are `apertureview.detailStatus`, not branches invented
 * here. UNKNOWN VOCABULARY RENDERS MUTED, ALWAYS: a status, tier, rung or state this
 * build has never heard of is printed as its literal in muted type — never dropped
 * (the sheet would silently shrink), never styled as though it were understood.
 */

/** Per-series evidence for a path row: the strip's levels and the one number beside
 *  it (a week's movement, or the latest day's count — `ActivitySeries.mode` says
 *  which). `null` value = measured but nothing to show, which renders as a dash. */
export interface EvidenceSeries {
  levels: number[];
  value: number | null;
}

/** The server evidence, keyed by the same names `paths[].activity` uses. Open by
 *  design: a series the sheet doesn't carry is simply absent, and the row renders
 *  bare rather than showing empty chrome. */
export type GuideEvidence = Readonly<
  Record<string, EvidenceSeries | undefined>
>;

/** What each band key is called on its divider, and in the one sealed line. */
const SECTION_LABEL: Record<string, string> = {
  "aperture-wall": "the wall",
  "aperture-conditions": "conditions",
  "aperture-paths": "paths",
  "aperture-trials": "trials",
};

/** The decrypted document plus the adjudication rider's one flag. */
interface Loaded {
  doc: ApertureDoc;
  /** Raw journal days have run ≥2 days past the seal — flag, never resolve. */
  pending: boolean;
}

/** Fetch one sealed vault blob's ciphertext through the same-origin owner-gated proxy. */
async function fetchRaw(p: string): Promise<Uint8Array> {
  const res = await fetch(`/api/vault/raw?p=${encodeURIComponent(p)}`);
  if (!res.ok) throw new Error(`vault raw ${p}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Whether the sealed picture is behind the raw journal — the adjudication dot. Needs
 * the newest raw day, which lives in the sealed vault index, so it is a SECOND fetch
 * and decrypt. Best-effort by construction: any miss returns false, because a dot
 * that can't be computed is a dot that shouldn't be lit.
 */
async function adjudicationPending(
  sealedAt: string,
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<boolean> {
  try {
    const { bytes } = await openItem(await fetchRaw(VAULT_INDEX_PATH));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isVaultIndex(parsed)) return false;
    const latest = latestDailyDay(parsed.notes.map((n) => n.title));
    return isAdjudicationPending(sealedAt, latest);
  } catch {
    return false;
  }
}

/**
 * The gym path's evidence, derived IN THE BROWSER. Every other strip on the band
 * is server-rendered, but the gym log lives in the E2EE `meta/gym` envelope — the
 * server cannot see a session, so it cannot draw one. Same rider doctrine as the
 * adjudication dot above: best-effort by construction, so ANY miss (no envelope
 * yet, a store flake, a shape this build doesn't trust) returns null and the row
 * renders bare, exactly as an undrawable series does. It never delays or fails
 * the sheet.
 */
async function gymSeries(
  today: string,
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<EvidenceSeries | null> {
  try {
    const res = await fetch("/api/gym");
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      GYM_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const cfg = normalizeGymConfig(parsed);
    if (!cfg) return null;
    // The same ten-week window every other strip in the band runs, so the row
    // lines up with its neighbours.
    return {
      levels: toLevels(sessionCounts(cfg, ACTIVITY_DAYS, today)),
      value: sessionsThisWeek(cfg, today),
    };
  } catch {
    return null;
  }
}

export function GuideSealed({
  sections,
  evidence,
  today,
  offline,
}: {
  sections: string[];
  evidence: GuideEvidence;
  today: string;
  offline: boolean;
}) {
  const { status, openItem } = useVault(offline);
  const totals = useFinTotals(offline);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  /** The one sealed strip, once it lands — see `gymSeries`. */
  const [gym, setGym] = useState<EvidenceSeries | null>(null);

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
      setGym(null);
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
        let doc: ApertureDoc;
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
          doc = next;
        } catch {
          if (!cancelled) setDataErr("tamper");
          return;
        }
        // The sheet lands first; the rider only lights a dot on it, so it must
        // never hold the document back or be able to fail it.
        if (!cancelled) setLoaded({ doc, pending: false });
        const pending = await adjudicationPending(doc.sealedAt, openItem);
        if (pending && !cancelled) setLoaded({ doc, pending });
        // The sealed strip, only when a path actually asks for it — it costs a
        // request and a decrypt, and most documents won't name it.
        if (declaredSeriesKeys(doc.sealed.paths).has("gym")) {
          const series = await gymSeries(today, openItem);
          if (series && !cancelled) setGym(series);
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem, today]);

  switch (detailStatus(status, dataErr, loaded?.doc ?? null)) {
    case "offline":
      // Store off — the feature is simply absent (DropInbox's precedent). There is
      // no key to want and no door to point at, so pointing at one would be noise.
      return null;

    case "sealed":
      // One honest block for all four bands: naming them is the whole content, since
      // what they'd say is exactly what the key is for.
      return (
        <SealedBlock sections={sections}>
          <Link href="/files" className="text-amber hover:underline">
            unlock in files →
          </Link>
        </SealedBlock>
      );

    case "decrypting":
      return <SealedBlock sections={sections}>decrypting…</SealedBlock>;

    case "unreachable":
      return <StatusLine>vault unreachable — reload to retry</StatusLine>;

    case "tamper":
      return <StatusLine>cannot decrypt — lock and unlock</StatusLine>;
  }

  // `ready` — narrowed by the switch above, but TS can't see it through the helper.
  if (!loaded) return null;
  const { streaks, conditions, paths, vitalGu, trials, breakthrough } =
    loaded.doc.sealed;
  const { open, resolved } = splitTrials(trials);

  // The server's evidence, plus the one series only this browser can produce. The
  // band consumes them identically — a sealed strip is not a special kind of row,
  // it just arrives later (and, on any miss, not at all).
  const allEvidence: GuideEvidence = gym ? { ...evidence, gym } : evidence;

  /**
   * One band, by its registry key. An unknown key renders nothing — the registry and
   * this table are edited together, and a key with no drawing is not a band. Neither
   * is a band with nothing in it: an empty one returns null rather than a divider
   * over a bordered strip of padding, the same rule the server zones follow.
   */
  const band = (key: string) => {
    switch (key) {
      case "aperture-wall": {
        const strikes = Object.entries(breakthrough.recentStrikes);
        const hasBody =
          breakthrough.event !== "" ||
          breakthrough.routes.length > 0 ||
          strikes.length > 0;
        if (!hasBody && !breakthrough.wall) return null;
        return (
          <>
            <ZoneHeader
              label="the wall"
              right={breakthrough.wall || undefined}
            />
            {hasBody && (
              <div className="border-b border-hairline px-4 py-3">
                {breakthrough.event && (
                  <p className="text-sm text-fg">{breakthrough.event}</p>
                )}
                {breakthrough.routes.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted">
                    routes ·{" "}
                    {breakthrough.routes.map((r, i) => (
                      <Fragment key={i}>
                        {i > 0 && " · "}
                        <span className="text-amber">{r}</span>
                      </Fragment>
                    ))}
                  </p>
                )}
                {strikes.length > 0 && (
                  <p className="mt-1 text-xs tabular-nums">
                    <span className="text-muted">strikes this week ·</span>{" "}
                    {strikes.map(([name, n], i) => (
                      <Fragment key={name}>
                        {i > 0 && <span className="text-muted"> · </span>}
                        <span className="text-fg/90">{name}</span>{" "}
                        <span className="text-amber">{n}</span>
                      </Fragment>
                    ))}
                  </p>
                )}
              </div>
            )}
          </>
        );
      }

      case "aperture-conditions":
        if (conditions.length === 0) return null;
        return (
          <>
            <ZoneHeader
              label="conditions"
              right={conditionsSummary(conditions) || undefined}
            />
            <div className="flex flex-wrap gap-2 border-b border-hairline px-4 py-3">
              {conditions.map((c, i) => (
                <span
                  key={i}
                  className={`inline-flex items-baseline gap-1.5 border px-2 py-0.5 text-xs ${conditionChipClass(c.status)}`}
                >
                  <span className="text-[10px] uppercase tracking-[0.08em]">
                    {conditionChipPrefix(c.status)}
                    {conditionStatusWord(c.status)}
                  </span>
                  <span className="text-fg/90">{c.label}</span>
                  <span className="tabular-nums text-muted">
                    {c.progress}/{c.target}
                  </span>
                </span>
              ))}
            </div>
          </>
        );

      case "aperture-paths":
        if (paths.length === 0) return null;
        return (
          <>
            <ZoneHeader label="paths" right="evidence · last 10 weeks" />
            <div className="border-b border-hairline">
              {paths.map((p, i) => (
                <PathRows
                  key={i}
                  path={p}
                  depth={0}
                  evidence={allEvidence}
                  totals={totals}
                />
              ))}
            </div>
          </>
        );

      case "aperture-trials":
        if (open.length === 0 && resolved.length === 0) return null;
        return (
          <>
            <ZoneHeader
              label="trials"
              right={trialsSummary(open, today) || undefined}
            />
            <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
              {open.map((t, i) => {
                const active = t.state === "active";
                const soon = isImminent(t.date, today);
                const when = trialCountdown(t.date, today);
                return (
                  <p key={i} className="text-xs">
                    <span
                      aria-hidden
                      className={active || soon ? "text-amber" : "text-muted"}
                    >
                      {active ? "●" : "◐"}
                    </span>{" "}
                    <span className="text-fg/90">{t.name}</span>{" "}
                    <span className="text-muted/60">
                      · {t.tier} · {t.state}
                      {active &&
                        t.opened !== undefined &&
                        ` · opened ${t.opened}`}
                    </span>
                    {!active && (
                      <>
                        <span className="text-muted/60"> · </span>
                        <span
                          className={
                            soon
                              ? "tabular-nums text-amber"
                              : "tabular-nums text-muted/60"
                          }
                        >
                          {when ?? "unscheduled"}
                        </span>
                      </>
                    )}
                  </p>
                );
              })}
              {resolved.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowResolved(!showResolved)}
                  className="self-start text-[11px] text-muted transition-colors hover:text-amber"
                >
                  {showResolved
                    ? "▴ hide resolved"
                    : `+${resolved.length} resolved ▸`}
                </button>
              )}
              {showResolved &&
                resolved.map((t, i) => (
                  <p key={i} className="text-xs text-muted/60">
                    {t.name} · {t.tier} · {t.state}
                    {t.date && (
                      <span className="tabular-nums"> · {t.date}</span>
                    )}
                  </p>
                ))}
            </div>
          </>
        );

      default:
        return null;
    }
  };

  const streakEntries = Object.entries(streaks);
  const hasMeta =
    streakEntries.length > 0 || vitalGu !== undefined || loaded.pending;

  return (
    <>
      {/* The masthead's own meta line, continued: the same muted 11px row, no
          divider above it, because these ARE the head of the sheet — the streaks
          the wall is waiting on, the gu, and the one dot that says the seal is
          behind the raw days. Nothing to say → no row at all, rather than a bordered
          strip of padding under the rank. */}
      {hasMeta && (
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 border-b border-hairline px-4 pb-3 text-[11px] text-muted">
          {streakEntries.map(([name, s]) => (
            <span key={name} className="tabular-nums">
              {name} <span className="text-amber">{s.count}</span>/{s.target}
            </span>
          ))}
          {loaded.pending && (
            <span
              aria-hidden
              title="raw journal days have run past the seal — adjudication pending"
              className="inline-block h-[7px] w-[7px] rounded-full bg-amber"
            />
          )}
          {vitalGu && (
            <span className="tabular-nums text-muted/60">
              vital gu · {vitalGu.name} {vitalGu.rank}/{vitalGu.max}
            </span>
          )}
        </div>
      )}

      {sections.map((key) => (
        <Fragment key={key}>{band(key)}</Fragment>
      ))}
    </>
  );
}

/** The locked / decrypting block: the bands named, then whatever comes next. */
function SealedBlock({
  sections,
  children,
}: {
  sections: string[];
  children: ReactNode;
}) {
  const names = sections
    .map((k) => SECTION_LABEL[k])
    .filter((n): n is string => n !== undefined);
  return (
    <p className="border-b border-hairline px-4 py-3 text-[13px] text-muted/55">
      {names.join(" · ")} <span className="text-muted/40">·····</span>{" "}
      {children}
    </p>
  );
}

/** A one-line failure, in the one colour a failure is allowed. */
function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-hairline px-4 py-3 text-xs text-down">
      {children}
    </p>
  );
}

/**
 * One path row, then its sub-paths as further rows indented under it — the sheet
 * reads them as siblings at different depths, not as a nested list. An attainment
 * this build knows reads a shade brighter; an unknown rung stays the muted literal,
 * never dressed as known.
 */
function PathRows({
  path,
  depth,
  evidence,
  totals,
}: {
  path: AperturePath;
  depth: number;
  evidence: GuideEvidence;
  totals: FinTotals | null;
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline/40 px-4 py-2 text-sm last:border-b-0">
        <span
          className={`w-[92px] shrink-0 text-fg/90 ${depth > 0 ? "pl-3.5" : ""}`}
        >
          {path.name}
          {path.role && (
            <span className="text-[11px] text-muted/60"> {path.role}</span>
          )}
        </span>
        <span className="w-[200px] shrink-0 text-xs text-muted">
          {path.attainment && (
            <span
              className={
                isAttainment(path.attainment) ? "text-fg/70" : "text-muted"
              }
            >
              {path.attainment}
            </span>
          )}
          {path.verified && <span className="text-up"> ✓</span>}
          {path.note && <span className="text-muted/60"> · {path.note}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-2.5">
          <Evidence path={path} evidence={evidence} totals={totals} />
        </span>
      </div>
      {path.sub?.map((s, i) => (
        <PathRows
          key={i}
          path={s}
          depth={depth + 1}
          evidence={evidence}
          totals={totals}
        />
      ))}
    </>
  );
}

/** A path's evidence: a number + strip for a series the sheet draws, the wealth
 *  figure for the wealth path, nothing at all otherwise. */
function Evidence({
  path,
  evidence,
  totals,
}: {
  path: AperturePath;
  evidence: GuideEvidence;
  totals: FinTotals | null;
}) {
  const ev = pathEvidence(path);
  if (ev === null) return null;

  if (ev.kind === "wealth") {
    return (
      <>
        <span className="text-xs tabular-nums">
          {totals ? (
            <>
              <span className="text-fg">{aud(totals.total)}</span>
              {totals.delta !== null && (
                <span className={tone(totals.delta)}>
                  {" "}
                  {arrow(totals.delta)} this month
                </span>
              )}
            </>
          ) : (
            <span className="text-muted/40">$·····</span>
          )}
        </span>
        <Link href="/portfolio" className="text-xs text-amber hover:underline">
          portfolio →
        </Link>
      </>
    );
  }

  // A declared series the server didn't send has no strip and no number — the same
  // silence an undrawable series gets, for the same reason.
  const series = evidence[ev.key];
  if (series === undefined) return null;
  const { mode, unit, label } = ev.series;
  return (
    <>
      <span className="text-xs tabular-nums">
        {series.value === null ? (
          <span className="text-muted">—</span>
        ) : mode === "delta" ? (
          <span className="text-amber">{signedCount(series.value)}</span>
        ) : (
          <span className="text-muted">{commas(series.value)}</span>
        )}
        {unit && <span className="text-muted"> {unit}</span>}
      </span>
      <span className="w-16 shrink-0">
        <ActivityStrip
          levels={series.levels}
          label={`${label}, last 10 weeks`}
        />
      </span>
    </>
  );
}
