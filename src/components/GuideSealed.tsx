"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { useFinTotals, type FinTotals } from "@/components/useFinTotals";
import { ACTIVITY_DAYS, toLevels } from "@/lib/activity";
import {
  APERTURE_CONTEXT,
  apertureHistPath,
  GYM_CONTEXT,
} from "@/lib/aevcontext";
import {
  isAdjudicationPending,
  isAttainment,
  normalizeAperture,
  type AperturePath,
  type ApertureDoc,
} from "@/lib/aperture";
import {
  planRecordFetch,
  recordRows,
  type RecordRow,
} from "@/lib/aperturerecord";
import {
  conditionChipClass,
  conditionChipPrefix,
  conditionStatusWord,
  conditionsSummary,
  declaredSeriesKeys,
  detailStatus,
  hardenLabel,
  imminentMajorTrial,
  isImminent,
  latestDailyDay,
  pathEvidence,
  signedCount,
  splitTrials,
  tallyMarks,
  tierGlyph,
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
  "aperture-record": "the record",
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

/** The record band's decrypted state: what to draw, and how much it is not
 *  drawing — capped-out days as a count, failed opens as an honest tally. */
interface RecordState {
  rows: RecordRow[];
  /** Well-formed archived days beyond the fetch cap — counted, never fetched. */
  older: number;
  /** Fetched days that would not serve, decrypt or normalize. */
  unreadable: number;
}

/**
 * The archived seal history, listed then opened — the record band's whole input.
 * Same rider doctrine as the gym strip below: best-effort by construction, so a
 * dead listing returns null and the band simply doesn't render, while a single
 * day that won't open is COUNTED rather than silently dropped — a record that
 * quietly under-reported history would defeat the point of keeping one. Each
 * envelope opens under its OWN dated key as AAD (the aevcontext family), so a
 * store answering one day's request with another week's bytes fails the open.
 */
async function recordSeries(
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<RecordState | null> {
  try {
    const res = await fetch("/api/aperture/hist");
    if (res.status !== 200) return null;
    const listing: unknown = await res.json();
    const days =
      typeof listing === "object" && listing !== null && "days" in listing
        ? (listing as { days: unknown }).days
        : null;
    const plan = planRecordFetch(days);
    if (plan.fetch.length === 0 && plan.older === 0) return null;
    const opened = await Promise.all(
      plan.fetch.map(async (day) => {
        try {
          const r = await fetch(`/api/aperture/hist?d=${day}`);
          if (r.status !== 200) return null;
          const { bytes } = await openItem(
            new Uint8Array(await r.arrayBuffer()),
            apertureHistPath(day),
          );
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          const doc = normalizeAperture(parsed);
          return doc ? { day, doc } : null;
        } catch {
          return null;
        }
      }),
    );
    const entries = opened.filter(
      (e): e is { day: string; doc: ApertureDoc } => e !== null,
    );
    return {
      rows: recordRows(entries),
      older: plan.older,
      unreadable: plan.fetch.length - entries.length,
    };
  } catch {
    return null;
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
  /** The archived seal history, once it lands — see `recordSeries`. */
  const [record, setRecord] = useState<RecordState | null>(null);
  // A boolean rather than the array, so the effect below re-runs only when the
  // band's visibility actually flips, not on every render's fresh prop identity.
  const wantsRecord = sections.includes("aperture-record");

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
      setRecord(null);
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
        // The seal history, only when the record band is visible — a listing
        // plus up to a dozen fetches and decrypts is real work, and a hidden
        // band must cost nothing.
        if (wantsRecord && !cancelled) {
          const rec = await recordSeries(openItem);
          if (rec && !cancelled) setRecord(rec);
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem, today, wantsRecord]);

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
          <Link href="/files" className="text-(--essence) hover:underline">
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
  // The one trial grave enough to be read at the top of the sheet rather than in
  // its own band — see `imminentMajorTrial`. Its countdown is the same wording the
  // band uses; without one the dot names the tier and nothing more.
  const majorTrial = imminentMajorTrial(open, today);
  const majorWhen = majorTrial && trialCountdown(majorTrial.date, today);

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
              seal="壁"
              right={breakthrough.wall || undefined}
            />
            {hasBody && (
              <div className="skin-masonry border-b border-hairline px-4 py-3">
                {breakthrough.event && (
                  <p className="text-sm text-fg">{breakthrough.event}</p>
                )}
                {breakthrough.routes.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted">
                    routes ·{" "}
                    {breakthrough.routes.map((r, i) => (
                      <Fragment key={i}>
                        {i > 0 && " · "}
                        <span className="text-(--essence)">{r}</span>
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
                        {/* the count inked as tally marks where it fits — the
                            digit always prints, the 正 only ever adds */}
                        {tallyMarks(n) && (
                          <span
                            aria-hidden
                            lang="zh"
                            className="font-[family-name:var(--font-zh)] tracking-[0.15em] text-cinnabar"
                          >
                            {tallyMarks(n)}{" "}
                          </span>
                        )}
                        <span className="text-(--essence)">{n}</span>
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
              seal="律"
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
            <ZoneHeader
              label="paths"
              seal="道"
              right="evidence · last 10 weeks"
            />
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
              seal="劫"
              right={trialsSummary(open, today) || undefined}
            />
            <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
              {open.map((t, i) => {
                const active = t.state === "active";
                const soon = isImminent(t.date, today);
                const when = trialCountdown(t.date, today);
                const glyph = tierGlyph(t.tier);
                return (
                  <p key={i} className="text-xs">
                    <span
                      aria-hidden
                      className={
                        active || soon ? "text-(--essence)" : "text-muted"
                      }
                    >
                      {active ? "●" : "◐"}
                    </span>{" "}
                    <span className="text-fg/90">{t.name}</span>{" "}
                    <span className="text-muted/60">
                      ·{" "}
                      {glyph && (
                        <span
                          aria-hidden
                          lang="zh"
                          className="font-[family-name:var(--font-zh)]"
                        >
                          {glyph}{" "}
                        </span>
                      )}
                      {t.tier} · {t.state}
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
                              ? "tabular-nums text-(--essence)"
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
                  className="self-start text-[11px] text-muted transition-colors hover:text-(--essence)"
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

      case "aperture-record": {
        if (!record) return null;
        // Every day the LISTING knew about, drawn or accounted for: rows on
        // screen, the capped-out tail, and the ones that wouldn't open.
        const total = record.rows.length + record.unreadable + record.older;
        if (total === 0) return null;
        return (
          <>
            <ZoneHeader
              label="the record"
              seal="录"
              right={`${total} seal${total === 1 ? "" : "s"}`}
            />
            <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
              {record.rows.map((r, i) => (
                <p key={r.day} className="text-xs">
                  <span
                    aria-hidden
                    className={`mr-1.5 inline-block h-[7px] w-[7px] bg-(--essence) ${i === 0 ? "" : "opacity-45"}`}
                  />
                  <span className="tabular-nums text-muted">{r.day}</span>{" "}
                  <span className="text-fg/90">
                    rank {r.rank} · {r.stage}
                  </span>
                  {r.essence !== null && (
                    <span className="text-muted/60"> · {r.essence}</span>
                  )}
                  {r.delta !== null && (
                    <span className="text-muted/60"> · {r.delta}</span>
                  )}
                </p>
              ))}
              {(record.older > 0 || record.unreadable > 0) && (
                <p className="text-[11px] text-muted/60">
                  {record.older > 0 && `+${record.older} earlier`}
                  {record.older > 0 && record.unreadable > 0 && " · "}
                  {record.unreadable > 0 &&
                    `${record.unreadable} unreadable — reload to retry`}
                </p>
              )}
            </div>
          </>
        );
      }

      default:
        return null;
    }
  };

  const streakEntries = Object.entries(streaks);
  const hasMeta =
    streakEntries.length > 0 ||
    vitalGu !== undefined ||
    loaded.pending ||
    majorTrial !== null;

  return (
    <>
      {/* The masthead's own meta line, continued: the same muted 11px row, no
          divider above it, because these ARE the head of the sheet — the streaks
          the wall is waiting on, the gu, and the dots: the seal behind the raw
          days, a major trial inside the week. Nothing to say → no row at all,
          rather than a bordered strip of padding under the rank. */}
      {hasMeta && (
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 border-b border-hairline px-4 pb-3 text-[11px] text-muted">
          {streakEntries.map(([name, s]) => (
            <span key={name} className="tabular-nums">
              {name} <span className="text-(--essence)">{s.count}</span>/
              {s.target}
              {s.earliestHarden !== undefined &&
                hardenLabel(s.earliestHarden) && (
                  <span className="text-muted/50">
                    {" "}
                    {hardenLabel(s.earliestHarden)}
                  </span>
                )}
            </span>
          ))}
          {loaded.pending && (
            <span
              aria-hidden
              title="raw journal days have run past the seal — adjudication pending"
              className="inline-block h-[7px] w-[7px] rounded-full bg-amber"
            />
          )}
          {majorTrial && (
            // The tribulation dot: square where the adjudication dot is round, and
            // cinnabar — the sheet's one fixed red, the same ink as its seals.
            <span
              aria-hidden
              title={`${majorTrial.tier} trial imminent${
                majorWhen ? ` — ${majorTrial.name} ${majorWhen}` : ""
              }`}
              className="inline-block h-[7px] w-[7px] bg-cinnabar"
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

/** The locked / decrypting block: the bands named, the cinnabar 封 pressed over
 *  them ("sealed" is the E2EE vocabulary — the stamp makes it literal), then
 *  whatever comes next. */
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
    <div className="relative border-b border-hairline px-4 py-5">
      <p className="pr-20 text-[13px] text-muted/55">
        {names.join(" · ")} <span className="text-muted/40">·····</span>{" "}
        {children}
      </p>
      <span
        aria-hidden
        lang="zh"
        className="skin-stamp absolute right-6 top-1/2 h-14 w-14 -translate-y-1/2 -rotate-6 border-[3px] text-[34px] opacity-75"
      >
        封
      </span>
    </div>
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
        <Link
          href="/portfolio"
          className="text-xs text-(--essence) hover:underline"
        >
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
          <span className="text-(--essence)">{signedCount(series.value)}</span>
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
      {/* The steps count is PUSHED by the companion app, so "refresh" means
          opening it — it syncs on foreground. Touch-only: a desktop click has
          no app to land in. Must target the app's BROWSABLE mandosteps://
          filter — browsers refuse to launch MAIN/LAUNCHER intents. */}
      {ev.key === "steps" && (
        <a
          href="intent://sync#Intent;scheme=mandosteps;package=dev.anthonyta.mandosteps;end"
          aria-label="sync steps now (opens the companion app)"
          className="hidden text-xs text-muted/40 transition-colors hover:text-(--essence) pointer-coarse:inline"
        >
          ↻
        </a>
      )}
    </>
  );
}
