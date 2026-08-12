"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { ExceptionLine } from "@/components/terminal/ExceptionLine";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { ACTIVITY_DAYS, toLevels } from "@/lib/activity";
import {
  APERTURE_CONTEXT,
  apertureHistPath,
  FIN_CONTEXT,
  GYM_CONTEXT,
  MEALS_CONTEXT,
} from "@/lib/aevcontext";
import {
  isAdjudicationPending,
  isAttainment,
  normalizeAperture,
  type AperturePath,
  type ApertureDoc,
  type ApertureGu,
  type ApertureVitalGu,
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
  imminentMajorTrial,
  isImminent,
  latestDailyDay,
  pathAnchor,
  pathEvidence,
  signedCount,
  splitTrials,
  tierGlyph,
  trialCountdown,
  trialsSummary,
  type EvidenceSeries,
  type PathSeries,
} from "@/lib/apertureview";
import {
  absorbedThisWeek,
  buildFullSeries,
  investedAt,
  latestEntry,
  monthToDateBaseline,
  normalizeFinConfig,
  recoveredThisWeek,
  type FinConfig,
} from "@/lib/fin";
import { normalizeGymConfig, sessionCounts, sessionsThisWeek } from "@/lib/gym";
import { dayTotals, normalizeMealsConfig, trailingProtein } from "@/lib/meals";
import { arrow, aud, tone } from "@/lib/money";
import { commas } from "@/lib/steps";
import { isVaultIndex, VAULT_INDEX_PATH } from "@/lib/vaultblob";

/**
 * ApertureInner — the full reading, as ONE client island: the sealed status document
 * and the sealed fin envelope, opened together in the browser and read side by side.
 * The server never holds either, so everything below the essence header is drawn
 * from bytes only this device can decrypt, and it all leaves again the moment the
 * vault locks.
 *
 * THIS IS WHERE THE READING LIVES. The home page keeps the present tense (the wall,
 * the conditions, the exceptions) and this page carries the rest: the paths and
 * their evidence, the trials, the seal history, then the inward look — the stones,
 * the foundation, the gu. Two envelopes and two riders in ONE island for the same
 * reason the sheet kept its bands together: it is all one reading, and splitting it
 * would mean fetching and decrypting the same blobs several times for one page.
 *
 * The document is authoritative and the money is a rider. A status document that
 * won't open is the page's red line (`tamper`, exactly as on the sheet); a fin
 * envelope that won't open is a figure this page can't print, so those figures read
 * as dashes and the rest carries on — the `useFinTotals` doctrine, where any miss
 * resolves to null rather than a pretend zero. The gym strip and the seal history
 * are riders on the same terms: any miss and they simply aren't drawn.
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

/** What the wealth path's row prints: the total in DOLLARS and the month-to-date
 *  movement. Derived from the fin envelope this page has already opened rather
 *  than from `useFinTotals` — the same arithmetic, one fewer fetch and decrypt. */
interface Wealth {
  total: number;
  /** Null during the first month of data — the row hides the Δ rather than fake one. */
  delta: number | null;
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

/** Fetch one sealed vault blob's ciphertext through the same-origin owner-gated proxy. */
async function fetchRaw(p: string): Promise<Uint8Array> {
  const res = await fetch(`/api/vault/raw?p=${encodeURIComponent(p)}`);
  if (!res.ok) throw new Error(`vault raw ${p}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Whether the sealed reading is behind the raw journal — the adjudication line.
 * Needs the newest raw day, which lives in the sealed vault index, so it is a SECOND
 * fetch and decrypt. Best-effort by construction: any miss returns false, because a
 * line that can't be computed is a line that shouldn't be shown.
 */
async function adjudicationPending(
  sealedAt: string,
  today: string,
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<boolean> {
  try {
    const { bytes } = await openItem(await fetchRaw(VAULT_INDEX_PATH));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isVaultIndex(parsed)) return false;
    const latest = latestDailyDay(
      parsed.notes.map((n) => n.title),
      today,
    );
    return isAdjudicationPending(sealedAt, latest);
  } catch {
    return false;
  }
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
 * server cannot see a session, so it cannot draw one. Best-effort by construction,
 * so ANY miss (no envelope yet, a store flake, a shape this build doesn't trust)
 * returns null and the row renders bare, exactly as an undrawable series does. It
 * never delays or fails the page.
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

/**
 * The meals path's evidence — the second sealed series, on gym's exact terms:
 * derived in the browser from the E2EE `meta/meals` envelope, best-effort by
 * construction, never able to delay or fail the page. Protein per day (the
 * macro the meal log accents), with today's count as the number beside the
 * strip — rounded, since decimal macros can put fractions in the sum.
 */
async function mealsSeries(
  today: string,
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<EvidenceSeries | null> {
  try {
    const res = await fetch("/api/meals");
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      MEALS_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const cfg = normalizeMealsConfig(parsed);
    if (!cfg) return null;
    return {
      levels: toLevels(trailingProtein(cfg, today, ACTIVITY_DAYS)),
      value: Math.round(dayTotals(cfg, today).p),
    };
  } catch {
    return null;
  }
}

export function ApertureInner({
  offline,
  series,
  today,
}: {
  offline: boolean;
  /** The server-assembled path evidence — commits, languages, steps. */
  series: PathSeries;
  /** The Sydney calendar day, anchored once on the server so the strips this page
   *  draws and the ones it derives in the browser can't sit on different days. */
  today: string;
}) {
  const { status, openItem } = useVault(offline);
  const [doc, setDoc] = useState<ApertureDoc | null>(null);
  const [fin, setFin] = useState<FinConfig | null>(null);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  /** The sealed strips, once they land — see `gymSeries` / `mealsSeries`. */
  const [gym, setGym] = useState<EvidenceSeries | null>(null);
  const [meals, setMeals] = useState<EvidenceSeries | null>(null);
  /** The archived seal history, once it lands — see `recordSeries`. */
  const [record, setRecord] = useState<RecordState | null>(null);
  /** Raw journal days have run ≥2 days past the seal — flag, never resolve. */
  const [pending, setPending] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

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
      setGym(null);
      setMeals(null);
      setRecord(null);
      setPending(false);
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

        // The money rider — best-effort by construction. It only fills figures,
        // so it must never hold the document back or be able to fail it.
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

        // The adjudication rider — one line at the head of the reading, so it goes
        // early; like every rider here it can only ADD, never hold the page back
        // and never fail it.
        const behind = await adjudicationPending(
          next.sealedAt,
          today,
          openItem,
        );
        if (behind && !cancelled) setPending(true);

        // The sealed strips, only when a path actually asks for them — each
        // costs a request and a decrypt, and a document may name neither.
        const declared = declaredSeriesKeys(next.sealed.paths);
        if (declared.has("gym")) {
          const gymEv = await gymSeries(today, openItem);
          if (gymEv && !cancelled) setGym(gymEv);
        }
        if (declared.has("meals")) {
          const mealsEv = await mealsSeries(today, openItem);
          if (mealsEv && !cancelled) setMeals(mealsEv);
        }

        // The seal history — a listing plus up to a dozen fetches and decrypts.
        const rec = await recordSeries(openItem);
        if (rec && !cancelled) setRecord(rec);
      } catch {
        if (!cancelled) setDataErr("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem, today]);

  switch (detailStatus(status, dataErr, doc)) {
    case "offline":
      return <StatusLine>store offline — set the R2_* env vars</StatusLine>;

    case "sealed":
      // The whole page is behind the key, so the seal IS the page: one stamp, one
      // line, and no list of what is being withheld — naming it would be the
      // reading itself.
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-12">
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
      return <p className="px-4 py-6 text-xs text-muted">decrypting…</p>;

    case "unreachable":
      return <StatusLine>vault unreachable — reload to retry</StatusLine>;

    case "tamper":
      return <StatusLine>cannot decrypt — lock and unlock</StatusLine>;
  }

  // `ready` — narrowed by the switch above, but TS can't see it through the helper.
  if (!doc) return null;
  const { conditions, paths, vitalGu, trials, breakthrough, rented } =
    doc.sealed;
  const { open, resolved } = splitTrials(trials);
  const strikes = Object.entries(breakthrough.recentStrikes);
  const hasWallBody =
    breakthrough.event !== "" ||
    breakthrough.routes.length > 0 ||
    strikes.length > 0;

  // The server's evidence, plus the series only this browser can produce. The
  // band consumes them identically — a sealed strip is not a special kind of row,
  // it just arrives later (and, on any miss, not at all).
  const allSeries: PathSeries = {
    ...series,
    ...(gym ? { gym } : {}),
    ...(meals ? { meals } : {}),
  };

  const recovered = fin ? recoveredThisWeek(fin, today) : null;
  const absorbed = fin ? absorbedThisWeek(fin, today) : null;
  const entry = fin ? latestEntry(fin) : null;
  // Cash and HISA are dollars in the envelope; every figure on this page is cents.
  const stones = fin
    ? Math.round(((entry?.cash ?? 0) + (entry?.hisa ?? 0)) * 100)
    : null;
  const invested = fin ? investedAt(fin, today) : null;
  const burn = fin?.burnWeeklyCents ?? null;

  // The wealth path's row — the same reading the sheet used to print, off the
  // envelope already open here. Month-to-date rather than a 7-day Δ: on weekly pay
  // a week's diff just echoes whether payday has happened yet.
  let wealth: Wealth | null = null;
  if (fin) {
    const netSeries = buildFullSeries(fin, today);
    const base = monthToDateBaseline(netSeries, today);
    const newest = netSeries.at(-1);
    wealth = {
      total: (invested ?? 0) / 100 + (entry?.cash ?? 0) + (entry?.hisa ?? 0),
      delta:
        base && newest ? (newest.totalCents - base.totalCents) / 100 : null,
    };
  }

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
  const recordTotal = record
    ? record.rows.length + record.unreadable + record.older
    : 0;

  // The one trial grave enough to be read at the TOP of the page rather than in
  // the trials band below it — see `imminentMajorTrial`.
  const majorTrial = imminentMajorTrial(open, today);
  const majorWhen = majorTrial && trialCountdown(majorTrial.date, today);

  return (
    <>
      {/* The two alarms, above every band. Nothing firing → nothing at all, which
          is the whole register: a quiet week opens straight into the wall. They
          live here rather than on the home page because this is where the reading
          is now, and an alarm belongs beside what it is an alarm about. */}
      {(majorTrial || pending) && (
        <div className="px-4 pb-3 pt-1">
          {majorTrial && (
            <ExceptionLine tone="down">
              ⚠ {majorTrial.name} · {majorTrial.tier}
              {majorWhen && ` — ${majorWhen}`}
            </ExceptionLine>
          )}
          {pending && (
            <ExceptionLine tone="amber">
              adjudication pending — seal the week
            </ExceptionLine>
          )}
        </div>
      )}

      {/* The status bands, in the register the sheet reads them in — the wall and
          the conditions first, then everything that was only ever readable at
          length. */}
      {(hasWallBody || breakthrough.wall) && (
        <>
          <ZoneHeader
            label="the wall"
            seal="壁"
            right={breakthrough.wall || undefined}
          />
          {hasWallBody && (
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
                      <span className="text-(--essence)">{n}</span>
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {conditions.length > 0 && (
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
      )}

      {paths.length > 0 && (
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
                series={allSeries}
                wealth={wealth}
              />
            ))}
          </div>
        </>
      )}

      {(open.length > 0 || resolved.length > 0) && (
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
                  {t.date && <span className="tabular-nums"> · {t.date}</span>}
                </p>
              ))}
          </div>
        </>
      )}

      {/* Every day the LISTING knew about, drawn or accounted for: rows on
          screen, the capped-out tail, and the ones that wouldn't open. */}
      {record && recordTotal > 0 && (
        <>
          <ZoneHeader
            label="the record"
            seal="录"
            right={`${recordTotal} seal${recordTotal === 1 ? "" : "s"}`}
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
      )}

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

/** A one-line failure, in the one colour a failure is allowed. The page header
 *  owns the hairline above it, so this line carries none of its own. */
function StatusLine({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-xs text-down">{children}</p>;
}

/**
 * One path row, then its sub-paths as further rows indented under it — the band
 * reads them as siblings at different depths, not as a nested list. An attainment
 * this build knows reads a shade brighter; an unknown rung stays the muted literal,
 * never dressed as known.
 *
 * A TOP-LEVEL row is a door onto its own card FURTHER DOWN THIS PAGE, where the
 * same path is read inward (its gu, and what the next rung asks for). Sub-paths
 * stay plain — the card renders them INSIDE their parent, so a sub-path has no
 * anchor of its own to point at.
 */
function PathRows({
  path,
  depth,
  series,
  wealth,
}: {
  path: AperturePath;
  depth: number;
  series: PathSeries;
  wealth: Wealth | null;
}) {
  const linked = depth === 0;

  return (
    <>
      <div
        className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline/40 px-4 py-2 text-sm last:border-b-0 ${
          linked ? "relative transition-colors hover:bg-surface/30" : ""
        }`}
      >
        {/* The door as an overlay rather than a container: the wealth row's
            evidence carries its own link to /portfolio, and an anchor inside an
            anchor is not a thing HTML has. Covering the row leaves the layout
            untouched and keeps both doors real — the evidence group below is
            raised over this one, so the portfolio link still takes its own click. */}
        {linked && (
          <Link
            href={`#${pathAnchor(path.name)}`}
            aria-label={`${path.name} · gu held`}
            className="absolute inset-0"
          />
        )}
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
          <span className="relative flex items-baseline gap-2.5">
            <Evidence path={path} series={series} wealth={wealth} />
          </span>
          {linked && <span className="text-xs text-muted/40">→</span>}
        </span>
      </div>
      {path.sub?.map((s, i) => (
        <PathRows
          key={i}
          path={s}
          depth={depth + 1}
          series={series}
          wealth={wealth}
        />
      ))}
    </>
  );
}

/** A path's evidence: a number + strip for a series the page draws, the wealth
 *  figure for the wealth path, nothing at all otherwise. */
function Evidence({
  path,
  series,
  wealth,
}: {
  path: AperturePath;
  series: PathSeries;
  wealth: Wealth | null;
}) {
  const ev = pathEvidence(path);
  if (ev === null) return null;

  if (ev.kind === "wealth") {
    return (
      <>
        <span className="text-xs tabular-nums">
          {wealth ? (
            <>
              <span className="text-fg">{aud(wealth.total)}</span>
              {wealth.delta !== null && (
                <span className={tone(wealth.delta)}>
                  {" "}
                  {arrow(wealth.delta)} this month
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
  const drawn = series[ev.key];
  if (drawn === undefined) return null;
  const { mode, unit, label } = ev.series;
  return (
    <>
      <span className="text-xs tabular-nums">
        {drawn.value === null ? (
          <span className="text-muted">—</span>
        ) : mode === "delta" ? (
          <span className="text-(--essence)">{signedCount(drawn.value)}</span>
        ) : (
          <span className="text-muted">{commas(drawn.value)}</span>
        )}
        {unit && <span className="text-muted"> {unit}</span>}
      </span>
      <span className="w-16 shrink-0">
        <ActivityStrip
          levels={drawn.levels}
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
    <div
      id={pathAnchor(path.name)}
      className="border border-hairline px-3 py-2.5"
    >
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
 *  silently dropped; the evidence strips stay in the paths band above, where the
 *  numbers are. */
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
