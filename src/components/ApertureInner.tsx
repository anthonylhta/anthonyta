"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { ActivityStrip } from "@/components/terminal/ActivityStrip";
import { ExceptionLine } from "@/components/terminal/ExceptionLine";
import { Sparkline } from "@/components/terminal/Sparkline";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { ACTIVITY_DAYS, toLevels } from "@/lib/activity";
import {
  APERTURE_CONTEXT,
  apertureHistPath,
  FIN_CONTEXT,
  GYM_CONTEXT,
  JOBS_CONTEXT,
  MEALS_CONTEXT,
} from "@/lib/aevcontext";
import {
  isAdjudicationPending,
  isAttainment,
  normalizeAperture,
  type AperturePath,
  type ApertureDoc,
  type ApertureGu,
  type ApertureGuHouse,
  type ApertureKillerMove,
  type ApertureSoul,
  type ApertureVitalGu,
} from "@/lib/aperture";
import {
  planRecordFetch,
  recordRows,
  recordTrends,
  strikeTrends,
  type RecordRow,
  type RecordTrend,
} from "@/lib/aperturerecord";
import {
  agoLabel,
  castReading,
  codeSpans,
  compactDollars,
  conditionChipClass,
  conditionChipPrefix,
  conditionStatusWord,
  conditionsSummary,
  daoRows,
  daysOpen,
  declaredSeriesKeys,
  detailStatus,
  evidenceDaysThisWeek,
  guHeldCount,
  hardenLines,
  imminentMajorTrial,
  isImminent,
  latestDailyDay,
  pathAnchor,
  pathEvidence,
  recordedDays,
  signedCount,
  splitLead,
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
  weeklyFlow,
  type FinConfig,
} from "@/lib/fin";
import {
  e1rmSeries,
  GYM_WEEKLY_TARGET,
  liftChips,
  normalizeGymConfig,
  plateauWeeks,
  sessionCounts,
  sessionsThisWeek,
  type GymConfig,
} from "@/lib/gym";
import {
  dayTotals,
  driftLabel,
  energyBalance,
  normalizeMealsConfig,
  trailingAverage,
  trailingProtein,
  weeklyWeightAverages,
  weightTrend,
  type MealsConfig,
} from "@/lib/meals";
import type { FormationRow, FormationStatus } from "@/lib/formations";
import { normalizeJobsConfig, sectSearch, type JobApp } from "@/lib/jobs";
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

/** How many rulings stand open before the rest go behind a `+n more` — enough to
 *  read the last check-in's reasoning without the band becoming the page. */
const RULINGS_SHOWN = 3;

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
  /** One strip per streak the fetched seals carried — the same entries read
   *  down the columns instead of across the rows. */
  trends: RecordTrend[];
  /** The same reading over the wall's strike counters, week by sealed week. */
  strikes: RecordTrend[];
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
 * The two facts the sealed vault index holds for this page — whether the reading
 * is behind the raw journal (the adjudication line) and how many distinct days
 * the journal records (the soul band's count: one recorded day is one man soul).
 * One SECOND fetch and decrypt serves both. Best-effort by construction: any miss
 * returns the say-nothing pair, because a line that can't be computed is a line
 * that shouldn't be shown.
 */
async function indexReading(
  sealedAt: string,
  today: string,
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<{ pending: boolean; soulDays: number | null }> {
  try {
    const { bytes } = await openItem(await fetchRaw(VAULT_INDEX_PATH));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isVaultIndex(parsed)) return { pending: false, soulDays: null };
    const titles = parsed.notes.map((n) => n.title);
    return {
      pending: isAdjudicationPending(sealedAt, latestDailyDay(titles, today)),
      soulDays: recordedDays(titles, today),
    };
  } catch {
    return { pending: false, soulDays: null };
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
      trends: recordTrends(entries),
      strikes: strikeTrends(entries),
      older: plan.older,
      unreadable: plan.fetch.length - entries.length,
    };
  } catch {
    return null;
  }
}

/**
 * The gym log, opened ONCE for the two readings it feeds: the gym path's evidence
 * strip (when a path declares it) and the vessel's training figures — the week's
 * sessions and the best estimate per lift, which no declaration gates, because
 * the body is read whether or not a path has been declared over it. Every other
 * strip on the paths band is server-rendered; this one can't be, since the log
 * lives in the E2EE `meta/gym` envelope and the server cannot see a session.
 *
 * Best-effort by construction, on the meal log's exact terms: ANY miss (no
 * envelope yet, a store flake, a shape this build doesn't trust) returns null and
 * the page carries on without either reading. It never delays or fails the page.
 */
async function gymConfig(
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<GymConfig | null> {
  try {
    const res = await fetch("/api/gym");
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      GYM_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeGymConfig(parsed);
  } catch {
    return null;
  }
}

/**
 * The application ledger, for the sect-search line under the trials band —
 * derived client-side off the sealed `meta/jobs` envelope (the dot-rider
 * pattern; never check-in-emitted). Best-effort like every rider: any miss
 * (including an empty first-run 404) returns null and the line isn't there.
 */
async function jobsApps(
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<JobApp[] | null> {
  try {
    const res = await fetch("/api/jobs");
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      JOBS_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeJobsConfig(parsed)?.apps ?? null;
  } catch {
    return null;
  }
}

/**
 * The meal log itself, opened ONCE for the two readings it feeds: the meals
 * path's evidence strip (protein, when a path asks for it) and the vessel's
 * weight trend (which no declaration gates — the body is read whether or not a
 * path has been declared over it). One fetch and one decrypt for both, on gym's
 * exact terms: best-effort by construction, so ANY miss returns null and the
 * page carries on without either reading.
 */
async function mealsConfig(
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<MealsConfig | null> {
  try {
    const res = await fetch("/api/meals");
    if (res.status !== 200) return null;
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      MEALS_CONTEXT,
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeMealsConfig(parsed);
  } catch {
    return null;
  }
}

export function ApertureInner({
  offline,
  formations,
  backupAt,
  series,
  sleepWeekAvg,
  sleepWeeks,
  stepsWeekAvg,
  today,
}: {
  offline: boolean;
  /** The formations band's rows, judged on the server off plaintext evidence
   *  (ADR 0167) — the island renders them verbatim. */
  formations: FormationRow[];
  /** The backup script's success stamp (the chores connector's read) — a
   *  "backup"-evidenced killer move's whole reading. Null = no record. */
  backupAt: string | null;
  /** The server-assembled path evidence — commits, languages, steps. */
  series: PathSeries;
  /** The week's mean minutes asleep, read on the server off the same plaintext
   *  class the step count rides — null when no night has been posted for the
   *  week. */
  sleepWeekAvg: number | null;
  /** The same figure over each of the last ten weeks, oldest → newest, with a
   *  week nothing was posted for as a null. */
  sleepWeeks: (number | null)[];
  /** The week's mean daily step count, read on the server: the step store is
   *  plaintext, so the vessel's walking figure needs no key — null when nothing
   *  has been posted for the week. */
  stepsWeekAvg: number | null;
  /** The Sydney calendar day, anchored once on the server so the strips this page
   *  draws and the ones it derives in the browser can't sit on different days. */
  today: string;
}) {
  const { status, openItem } = useVault(offline);
  const [doc, setDoc] = useState<ApertureDoc | null>(null);
  const [fin, setFin] = useState<FinConfig | null>(null);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  /** The sealed gym log, once it lands — the training strip and the vessel's
   *  figures are both derived from it below. */
  const [gymCfg, setGymCfg] = useState<GymConfig | null>(null);
  /** The sealed meal log, once it lands — the protein strip and the vessel are
   *  both derived from it below. */
  const [mealsCfg, setMealsCfg] = useState<MealsConfig | null>(null);
  /** The archived seal history, once it lands — see `recordSeries`. */
  const [record, setRecord] = useState<RecordState | null>(null);
  /** Raw journal days have run ≥2 days past the seal — flag, never resolve. */
  const [pending, setPending] = useState(false);
  /** The soul's raw count off the same index read — null renders the grade alone. */
  const [soulDays, setSoulDays] = useState<number | null>(null);
  /** The application ledger, for the sect-search line — null = no line. */
  const [jobs, setJobs] = useState<JobApp[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  /** Which harvest entries are open, keyed by day + title — every one starts
   *  closed, so the band reads as a list of what was yielded, not a wall of it. */
  const [openHarvest, setOpenHarvest] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [showRulings, setShowRulings] = useState(false);

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
      setGymCfg(null);
      setMealsCfg(null);
      setRecord(null);
      setPending(false);
      setSoulDays(null);
      setJobs(null);
      setShowResolved(false);
      setOpenHarvest(new Set());
      setShowRulings(false);
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

        // The index rider — the adjudication line at the head of the reading and
        // the soul's day count, off one fetch; like every rider here it can only
        // ADD, never hold the page back and never fail it.
        const idx = await indexReading(next.sealedAt, today, openItem);
        if (!cancelled) {
          if (idx.pending) setPending(true);
          setSoulDays(idx.soulDays);
        }

        // Both sealed logs — one request and one decrypt each, unconditionally:
        // the vessel band reads a body, which no path has to have been declared
        // over. The two evidence strips still wait on a declaration, but they
        // come off these same bytes rather than a second decrypt.
        const meals = await mealsConfig(openItem);
        if (meals && !cancelled) setMealsCfg(meals);

        const gymLog = await gymConfig(openItem);
        if (gymLog && !cancelled) setGymCfg(gymLog);

        // The sect-search rider — same best-effort terms.
        const apps = await jobsApps(openItem);
        if (apps && !cancelled) setJobs(apps);

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

  // The meals path's evidence, off the log already open here — protein per day
  // (the macro the meal log accents) with today's count beside it, rounded since
  // decimal macros put fractions in the sum. Only when a path asks for it: an
  // undeclared series is one the band would never draw.
  const mealsEvidence = useMemo<EvidenceSeries | null>(() => {
    if (!doc || !mealsCfg) return null;
    if (!declaredSeriesKeys(doc.sealed.paths).has("meals")) return null;
    return {
      levels: toLevels(trailingProtein(mealsCfg, today, ACTIVITY_DAYS)),
      value: Math.round(dayTotals(mealsCfg, today).p),
    };
  }, [doc, mealsCfg, today]);

  // The gym path's evidence, off the log already open here — sessions per day over
  // the same ten-week window every other strip in the band runs, so the row lines
  // up with its neighbours, and this week's count beside it. Declaration-gated for
  // the meals strip's reason: an undeclared series is one the band would never draw.
  const gymEvidence = useMemo<EvidenceSeries | null>(() => {
    if (!doc || !gymCfg) return null;
    if (!declaredSeriesKeys(doc.sealed.paths).has("gym")) return null;
    return {
      levels: toLevels(sessionCounts(gymCfg, ACTIVITY_DAYS, today)),
      value: sessionsThisWeek(gymCfg, today),
    };
  }, [doc, gymCfg, today]);

  // Ten weeks of the ledger, walked once per envelope rather than once per render:
  // it is the same two readings the stats grid prints, taken ten times over.
  const flow = useMemo(
    () => (fin ? weeklyFlow(fin, today) : { recovered: [], rate: [] }),
    [fin, today],
  );

  // The dao band's rows (ADR 0167): the sealed ledgers off the paths tree, each
  // with its live weekly accrual where the node's OWN activity has a computable
  // series — the sealed count and the live week side by side, never derived
  // from each other. A node without a series just prints without the column.
  const dao = useMemo(() => {
    if (!doc) return [];
    const accrual = (activity: string | null): number | null => {
      if (activity === null) return null;
      if (activity === "gym")
        return gymCfg ? sessionsThisWeek(gymCfg, today) : null;
      if (activity === "meals")
        return mealsCfg
          ? evidenceDaysThisWeek(
              trailingProtein(mealsCfg, today, ACTIVITY_DAYS),
            )
          : null;
      const s = (series as Record<string, EvidenceSeries | undefined>)[
        activity
      ];
      return s ? evidenceDaysThisWeek(s.levels) : null;
    };
    return daoRows(doc.sealed.paths).map((r) => ({
      ...r,
      wk: accrual(r.activity),
    }));
  }, [doc, gymCfg, mealsCfg, series, today]);

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
  const { conditions, paths, vitalGu, trials, breakthrough, rented, soul } =
    doc.sealed;
  const guHouses = doc.sealed.guHouses;
  const { open, resolved } = splitTrials(trials);
  const harden = hardenLines(doc.sealed.streaks);
  const strikes = Object.entries(breakthrough.recentStrikes);
  const hasWallBody =
    breakthrough.event !== "" ||
    breakthrough.routes.length > 0 ||
    strikes.length > 0;

  // The two prose bands, newest first — sorted here rather than trusted from the
  // seal, because the emitter's order is a writing order and the page reads back
  // in time. `YYYY-MM-DD` sorts as it counts, so the comparison is the string's.
  const harvest = [...(doc.sealed.enlightenments ?? [])].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const rulings = [...(doc.sealed.rulings ?? [])].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const toggleHarvest = (key: string) =>
    setOpenHarvest((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // The server's evidence, plus the series only this browser can produce. The
  // band consumes them identically — a sealed strip is not a special kind of row,
  // it just arrives later (and, on any miss, not at all).
  const allSeries: PathSeries = {
    ...series,
    ...(gymEvidence ? { gym: gymEvidence } : {}),
    ...(mealsEvidence ? { meals: mealsEvidence } : {}),
  };

  // The vessel — the body itself, read from the two sealed logs and the one
  // plaintext store: the week's training against its target, how far it walked,
  // what it was fed, what it can lift, and where its weight is going. Each figure
  // is drawn only if it exists; the band itself exists only if any of them do,
  // because absence is the rule and an empty vessel is not a reading.
  //
  // Two weeks is the least either strip can be drawn as a trend, so below that
  // it is absent even when the rest of the band is present: a lone point is not
  // a picture.
  //
  // A week the phone posted nothing for drops OUT of the rest strip rather than
  // landing in it as a zero-hour night — the same hole the weight strip leaves
  // for an unweighed week, and for the same reason: padding a gap would draw a
  // cliff to the floor and back.
  const sleepStrip = sleepWeeks.filter((v): v is number => v !== null);
  const weightWeeks = mealsCfg ? weeklyWeightAverages(mealsCfg, today) : [];
  const weightNow = mealsCfg ? weightTrend(mealsCfg, today) : null;
  const weightDrift =
    weightNow && weightNow.deltaPerWeek !== null
      ? driftLabel(weightNow.deltaPerWeek)
      : null;
  // Each chip's figure, the progression behind it, and how long that figure has
  // stood — the same series /gym plots per exercise, taken off the log already
  // open here.
  const lifts = gymCfg
    ? liftChips(gymCfg).map((l) => ({
        ...l,
        series: e1rmSeries(gymCfg, l.id),
        plateau: plateauWeeks(gymCfg, l.id, today),
      }))
    : [];
  const fed = mealsCfg ? trailingAverage(mealsCfg, today, 7) : null;
  // What the two logs say together, when both are kept well enough to be asked:
  // null unless the drift was earned AND most of the week was written down.
  const balance = mealsCfg ? energyBalance(mealsCfg, today) : null;
  const hasVesselStats =
    gymCfg !== null ||
    stepsWeekAvg !== null ||
    sleepWeekAvg !== null ||
    fed !== null;
  const hasVessel =
    hasVesselStats || weightWeeks.length >= 2 || sleepStrip.length >= 2;

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

      {/* What the NEXT seal is waiting on, in the check-in's own words. It sits
          under the plaintext sea rather than inside it because the line is SEALED:
          it names conditions and dates, and the glance stays rank and stage alone.
          Printed verbatim — the site never computes a stage. */}
      {doc.sealed.next && (
        <div className="border-b border-hairline px-4 py-2.5">
          <p className="text-xs text-muted">
            <span className="text-muted/60">next · </span>
            {doc.sealed.next}
          </p>
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
          <div className="border-b border-hairline px-4 py-3">
            <div className="flex flex-wrap gap-2">
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
            {/* When each hardening streak comes due — BELOW the chips, not inside
                them: a hardening chip already reaches the edge of a phone. */}
            {harden.length > 0 && (
              <p className="mt-2 text-[11px] tabular-nums text-muted">
                {harden.join(" · ")}
              </p>
            )}
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
              const since = active ? daysOpen(t.opened, today) : null;
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
                    {active && t.opened !== undefined && (
                      <>
                        {` · opened ${t.opened}`}
                        {since !== null && (
                          <span className="tabular-nums"> · {since}</span>
                        )}
                      </>
                    )}
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
              resolved.map((t, i) => {
                const ago = agoLabel(t.date, today);
                return (
                  <p key={i} className="text-xs text-muted/60">
                    {t.name} · {t.tier} · {t.state}
                    {t.date && (
                      <span className="tabular-nums">
                        {" "}
                        · {t.date}
                        {ago !== null && ` · ${ago}`}
                      </span>
                    )}
                  </p>
                );
              })}
            {/* The sect search — the job-search trial's evidence, derived off the
                sealed application ledger (ADR 0166). A line beneath the trial,
                never a claim about it: the check-in still owns the trial's state. */}
            {jobs !== null &&
              jobs.length > 0 &&
              (() => {
                const s = sectSearch(jobs);
                return (
                  <p className="text-[11px] tabular-nums text-muted">
                    sect search ·{" "}
                    <span className="text-fg/80">{s.underway}</span> audience
                    {s.underway === 1 ? "" : "s"} underway ·{" "}
                    <span className="text-fg/80">{s.inTrial}</span> in trial ·{" "}
                    <span className="text-fg/80">{s.turnedAway}</span> turned
                    away
                  </p>
                );
              })()}
          </div>
        </>
      )}

      {/* What the trials YIELDED — the band sits directly under them because it is
          the other half of the same reading: a trial is what happened, an
          enlightenment is what was taken from it. Every entry starts closed, so
          the band reads as a list and opens into a passage only when asked. */}
      {harvest.length > 0 && (
        <>
          <ZoneHeader
            label="the harvest"
            seal="悟"
            right={`${harvest.length} ${harvest.length === 1 ? "entry" : "entries"}`}
          />
          <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
            {harvest.map((e) => {
              const key = `${e.date}${e.title}`;
              const shown = openHarvest.has(key);
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => toggleHarvest(key)}
                    aria-expanded={shown}
                    className="text-left text-xs"
                  >
                    <span className="tabular-nums text-muted">{e.date}</span>{" "}
                    <span className="text-fg/90">{e.title}</span>
                    {e.trial && (
                      <span className="text-muted/60"> · {e.trial}</span>
                    )}{" "}
                    <span className="text-muted">{shown ? "▾" : "▸"}</span>
                  </button>
                  {shown && (
                    <div className="mt-1 mb-1.5 ml-4 flex flex-col gap-1.5 text-xs leading-relaxed text-fg/80">
                      {e.body.map((paragraph, i) => {
                        // The passage as sealed. The one piece of markup read here
                        // is the bold lead the check-in opens a numbered passage
                        // with; everything else prints exactly as it was written.
                        const { lead, rest } = splitLead(paragraph);
                        return (
                          <p key={i}>
                            {lead && <span className="text-fg/90">{lead}</span>}
                            {rest}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="mt-1 text-[11px] italic text-muted/60">
              the record is the harvest, never the suffering — recorded only
              through yield.
            </p>
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
            {/* The rows read a week at a time; these read the whole fetched
                history at once — left to right in time, the opposite direction
                to the list above. */}
            {record.trends.length > 0 && (
              <>
                <p className="mt-2 mb-1 text-[10px] uppercase tracking-[0.12em] text-muted/60">
                  streaks · seal by seal
                </p>
                {record.trends.map((t) => (
                  <TrendRow
                    key={t.name}
                    label={t.name}
                    values={t.values}
                    delta={t.last - t.first}
                    plot={`${t.name} streak across seals`}
                    right={`${t.first} → ${t.last}${
                      t.target !== null ? ` / ${t.target}` : ""
                    }`}
                  />
                ))}
              </>
            )}
            {/* The wall's own counters, read the same way. No target: the wall
                breaks on an event, not on a number of strikes. */}
            {record.strikes.length > 0 && (
              <>
                <p className="mt-2 mb-1 text-[10px] uppercase tracking-[0.12em] text-muted/60">
                  strikes · week by seal
                </p>
                {record.strikes.map((t) => (
                  <TrendRow
                    key={t.name}
                    label={t.name}
                    values={t.values}
                    delta={t.last - t.first}
                    plot={`${t.name} strikes across seals`}
                    right={`${t.first} → ${t.last}`}
                  />
                ))}
              </>
            )}
          </div>
        </>
      )}

      {/* The decisions behind the figures, under the history they explain: the
          record says what each seal READ, and these say why it read that way. */}
      {rulings.length > 0 && (
        <>
          <ZoneHeader
            label="rulings"
            seal="判"
            right={`last ${rulings.length}`}
          />
          <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
            {(showRulings ? rulings : rulings.slice(0, RULINGS_SHOWN)).map(
              (r, i) => (
                <p key={i} className="text-[11px] leading-relaxed text-muted">
                  <span className="tabular-nums text-muted/60">{r.date}</span> ·{" "}
                  {r.text}
                </p>
              ),
            )}
            {rulings.length > RULINGS_SHOWN && (
              <button
                type="button"
                onClick={() => setShowRulings(!showRulings)}
                className="self-start text-[11px] text-muted transition-colors hover:text-(--essence)"
              >
                {showRulings
                  ? "▴ fewer"
                  : `+${rulings.length - RULINGS_SHOWN} more ▸`}
              </button>
            )}
          </div>
        </>
      )}

      {/* 阵 — what the aperture sustains without its owner (ADR 0167). Always
          all five rows, unconditionally: this band's whole point is that an
          absent row can't go amber (the briefing-skip lesson). */}
      <FormationsBand rows={formations} />

      {/* 杀 — what only the owner casts, directly under what runs without him:
          the two halves of the duality read top-to-bottom. Emission-gated like
          the soul — absent until a seal carries the definitions. */}
      {doc.sealed.killerMoves && doc.sealed.killerMoves.length > 0 && (
        <KillerMovesBand
          moves={doc.sealed.killerMoves}
          recordTotal={recordTotal}
          sealedAt={doc.sealedAt}
          backupAt={backupAt}
        />
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
        {/* The same two readings, ten weeks deep. Absorbed is not here on purpose:
            on a weekly buy it barely moves, so the rate is what a strip can say. */}
        {(flow.recovered.length >= 2 || flow.rate.length >= 2) && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted/60">
              flow · last 10 weeks
            </p>
            {flow.recovered.length >= 2 && (
              <TrendRow
                label="recovered"
                values={flow.recovered}
                delta={
                  flow.recovered[flow.recovered.length - 1] - flow.recovered[0]
                }
                plot="recovered per week, last ten weeks"
                right={`${compactDollars(flow.recovered[0])} → ${compactDollars(
                  flow.recovered[flow.recovered.length - 1],
                )}`}
              />
            )}
            {flow.rate.length >= 2 && (
              <TrendRow
                label="rate"
                values={flow.rate}
                delta={flow.rate[flow.rate.length - 1] - flow.rate[0]}
                plot="absorption rate per week, last ten weeks"
                right={`${flow.rate[0]}% → ${flow.rate[flow.rate.length - 1]}%`}
              />
            )}
          </div>
        )}
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

      {hasVessel && (
        <Section label="the vessel">
          {hasVesselStats && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {gymCfg && (
                <Stat
                  label="sessions this wk"
                  value={`${sessionsThisWeek(gymCfg, today)}`}
                  suffix={`/ ${GYM_WEEKLY_TARGET}`}
                />
              )}
              {stepsWeekAvg !== null && (
                <Stat label="steps · 7d avg" value={commas(stepsWeekAvg)} />
              )}
              {sleepWeekAvg !== null && (
                <Stat
                  label="sleep · 7d avg"
                  value={(sleepWeekAvg / 60).toFixed(1)}
                  suffix="h"
                />
              )}
              {fed && (
                <Stat
                  label="protein · 7d avg"
                  value={`${Math.round(fed.avg.p)}`}
                  suffix="g"
                />
              )}
            </div>
          )}
          {/* What the vessel can move, one chip per lift — Epley's estimate, so
              the line compares efforts the log recorded at different reps. */}
          {lifts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-baseline gap-1.5 text-xs">
              <span className="mr-0.5 text-[10px] uppercase tracking-[0.15em] text-muted">
                e1rm
              </span>
              {lifts.map((l) => (
                <span
                  key={l.id}
                  className="border border-hairline px-1.5 py-px tabular-nums text-muted"
                >
                  <span className="text-fg/90">{l.name}</span> {l.e1rm}
                  {/* Trained since, and no higher for it (`plateauWeeks`) — the
                      one thing a chip can say that the number can't. */}
                  {l.plateau !== null && (
                    <span className="text-amber"> · {l.plateau}wk</span>
                  )}
                  {/* Where the figure came from, at chip scale — two points is
                      the least a line can mean anything with. The shared
                      sparkline sizes itself (`h-12 w-full`), so the wrapper
                      names the height a chip can carry and outranks it on the
                      child selector. Flat `delta` keeps it muted: the number is
                      the reading, and six coloured squiggles would out-shout the
                      band's own strips. */}
                  {l.series.length >= 2 && (
                    <span className="ml-1.5 inline-block w-16 align-middle [&>svg]:h-4">
                      <Sparkline
                        values={l.series}
                        delta={0}
                        width={64}
                        height={16}
                        label={`${l.name} estimated 1RM progression`}
                      />
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
          {sleepStrip.length >= 2 && (
            <div className="mt-3">
              <TrendRow
                label="sleep"
                values={sleepStrip}
                delta={sleepStrip[sleepStrip.length - 1] - sleepStrip[0]}
                plot="weekly average sleep, last ten weeks"
                // Hours, and no unit in the cell — the weight strip's rule, and
                // the figure above the band already says which unit it is.
                right={`${(sleepStrip[0] / 60).toFixed(1)} → ${(
                  sleepStrip[sleepStrip.length - 1] / 60
                ).toFixed(1)}`}
              />
            </div>
          )}
          {weightWeeks.length >= 2 && (
            <>
              <div className="mt-3">
                <TrendRow
                  label="weight"
                  values={weightWeeks}
                  delta={weightWeeks[weightWeeks.length - 1] - weightWeeks[0]}
                  plot="weekly average bodyweight, last ten weeks"
                  // No unit in the cell — it overflowed the phone; the line below owns it.
                  right={`${weightWeeks[0].toFixed(1)} → ${weightWeeks[
                    weightWeeks.length - 1
                  ].toFixed(1)}`}
                />
              </div>
              <p className="mt-2 text-[11px] tabular-nums text-muted">
                {weightNow?.avg != null && (
                  <>
                    this week{" "}
                    <span className="text-fg/90">
                      {weightNow.avg.toFixed(1)} kg
                    </span>
                    {weightDrift && (
                      <>
                        {" · "}
                        <span className={weightDrift.tone}>
                          {weightDrift.text} kg/wk
                        </span>
                      </>
                    )}
                    {" · "}
                  </>
                )}
                weekly averages, 10 wk
              </p>
            </>
          )}
          {/* What the scale and the log say together — an estimate, and printed
              in the muted register the rest of the band reads in rather than a
              colour, because a surplus is a direction and not a verdict. */}
          {balance && (
            <p className="mt-2 text-[11px] tabular-nums text-muted">
              balance ·{" "}
              <span className="text-fg/90">
                {signedCount(balance.surplus)} kcal/day
              </span>
              {" · "}
              tdee ≈ <span className="text-fg/90">{commas(balance.tdee)}</span>
            </p>
          )}
          <Flavor>
            the vessel every path runs on — read the average, never the morning.
          </Flavor>
        </Section>
      )}

      {/* 魂 — the second axis beside rank, directly after the vessel: body, then
          soul, the two facets of the one being. Absent on every document sealed
          before the axis existed. */}
      {soul && <SoulBand soul={soul} days={soulDays} />}

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

      {/* 道 — the dao-mark composition (ADR 0167), directly under the paths it
          reads from. Absent until a seal opens a ledger on some path. */}
      {dao.length > 0 && <DaoBand rows={dao} />}

      {/* 府 — the colophon: the page ends with the thing that holds everything
          above it. When the house stands it absorbs the bare rented footnote as
          its essence line (same sealed list, better home); until a seal names a
          house, the footnote renders as it always has. */}
      {guHouses && guHouses.length > 0 ? (
        <GuHouseBand
          houses={guHouses}
          formationsCount={formations.length}
          movesCount={doc.sealed.killerMoves?.length ?? 0}
          guHeld={guHeldCount(paths)}
          rented={rented}
        />
      ) : (
        rented &&
        rented.length > 0 && (
          <p className="px-4 pb-4 text-[11px] text-muted">
            rented · {rented.join(" · ")}
          </p>
        )
      )}
    </>
  );
}

/**
 * 魂 — the soul band (ADR 0165): the second axis beside rank, a facet and never a
 * path. Every word here is ADJUDICATED — grade, next band, the gate's state all
 * print off the seal verbatim, because the gate (a band cannot be crossed
 * unrefined; refusal is the strained state) is a check-in ruling the site must
 * never recompute. The page's one computation is the raw day count beside the
 * grade, off the vault index (one recorded day is one man soul) — a count that
 * has touched the floor while the seal still reads the old grade is not a
 * mismatch, it is the pre-adjudication state between a crossing and its check-in.
 * Mid-band "unrefined" stays muted (normal, for most of a band's years); amber
 * belongs to strained alone.
 */
function SoulBand({ soul, days }: { soul: ApertureSoul; days: number | null }) {
  return (
    <div className="border-t border-hairline">
      <ZoneHeader label="the soul" seal="魂" right={soul.grade} />
      <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
        <p className="text-xs">
          <span className="text-fg/90">{soul.grade}</span>
          {days !== null && (
            <span className="tabular-nums text-muted">
              {" · "}
              {days.toLocaleString("en-AU")} days recorded
            </span>
          )}
          {soul.strained && (
            <span className="ml-2 border border-amber/50 px-1 text-[10px] tracking-[0.08em] text-amber">
              strained
            </span>
          )}
        </p>
        {soul.strained ? (
          <p className="text-[11px] tabular-nums text-muted">
            <span className="text-amber">{soul.next} held</span>
            <span className="text-muted/60">
              {" — "}
              {soul.harvested === 0
                ? "no harvest this band"
                : `${soul.harvested} harvested`}
              {" · refine to cross"}
            </span>
          </p>
        ) : (
          <p className="text-[11px] tabular-nums text-muted">
            next · {soul.next} at {soul.at.toLocaleString("en-AU")}
            <span className="text-muted/60"> — </span>
            {soul.refined ? (
              <span className="text-(--essence)">refined ✓</span>
            ) : (
              <span>unrefined</span>
            )}
            <span className="text-muted/60">
              {" · "}
              {soul.harvested} harvested this band
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

/** Formation-status dots and label tints: green turning, amber a missed turn,
 *  red stopped/broken, muted for the honest nothing-states. */
const FORMATION_DOT: Record<FormationStatus, string> = {
  ok: "text-up",
  armed: "text-up",
  due: "text-amber",
  overdue: "text-down",
  broken: "text-down",
  unknown: "text-muted",
  off: "text-muted",
};
const FORMATION_LAST: Record<FormationStatus, string> = {
  ok: "text-muted",
  armed: "text-muted",
  due: "text-amber",
  overdue: "text-down",
  broken: "text-down",
  unknown: "text-muted",
  off: "text-muted",
};

/**
 * 阵 — the formations band (ADR 0167): everything autonomous, one row each,
 * judged on the server from evidence the machinery itself wrote (never
 * self-reported). Rendered verbatim; the rows are props because every read is
 * plaintext hub state needing no key.
 */
function FormationsBand({ rows }: { rows: FormationRow[] }) {
  const allTurning = rows.every(
    (r) => r.status === "ok" || r.status === "armed",
  );
  return (
    <>
      <ZoneHeader
        label="formations"
        seal="阵"
        right={`${rows.length} standing${allTurning ? " · all turning" : ""}`}
      />
      <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
        {rows.map((r) => (
          <p key={r.key} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden
              className={`shrink-0 text-[11px] ${FORMATION_DOT[r.status]}`}
            >
              ●
            </span>
            <span className="w-[132px] shrink-0 text-fg/90">{r.name}</span>
            <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted sm:block">
              {r.what}
            </span>
            <span
              className={`ml-auto shrink-0 text-[11px] tabular-nums ${FORMATION_LAST[r.status]}`}
            >
              {r.last}
            </span>
          </p>
        ))}
        <p className="mt-1 text-[11px] italic text-muted/60">
          a formation needs attention only when it stops — amber is one missed
          turn.
        </p>
      </div>
    </>
  );
}

/**
 * 杀 — the killer moves band (roadmap 92b): the named composite rituals, one
 * compact row each, unfolding into the casting's literal steps. Definitions
 * arrive sealed and print verbatim; the right-hand reading is the ONLY thing
 * the site adds, derived per move from the evidence its `evidence` source
 * actually holds (`castReading`) — a band that remembers and documents, never
 * a nag: cadence pressure stays on the needs-doing board. Unmounts with the
 * document, so the unfold state dies with the key like everything sealed.
 */
function KillerMovesBand({
  moves,
  recordTotal,
  sealedAt,
  backupAt,
}: {
  moves: ApertureKillerMove[];
  /** Archived seals, fetched or counted — one dated seal per cast. */
  recordTotal: number;
  sealedAt: string;
  backupAt: string | null;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  // Anchored once at mount (render stays pure): the band unmounts with the key,
  // so every unlock reads a fresh clock — day-granular ages can't go stale.
  const [nowMs] = useState(() => Date.now());
  return (
    <>
      <ZoneHeader
        label="killer moves"
        seal="杀"
        right={`${moves.length} named`}
      />
      <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
        {moves.map((m) => (
          <div key={m.name}>
            <button
              type="button"
              onClick={() => toggle(m.name)}
              className="flex w-full items-baseline gap-2 text-left text-xs"
            >
              <span aria-hidden className="shrink-0 text-[10px] text-muted/60">
                {open.has(m.name) ? "▾" : "▸"}
              </span>
              <span className="w-[148px] shrink-0 truncate text-fg/90">
                {m.name}
              </span>
              <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted sm:block">
                {m.chain}
              </span>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
                {castReading(
                  m.evidence,
                  { recordTotal, sealedAt, backupAt },
                  nowMs,
                )}
              </span>
            </button>
            {open.has(m.name) && (
              <div className="mt-1 mb-1 ml-5 flex flex-col gap-1 text-[11px] text-muted">
                {m.steps.map((s, i) => (
                  <p key={i} className="flex items-baseline gap-2">
                    <span className="shrink-0 tabular-nums text-muted/60">
                      {i + 1}
                    </span>
                    <span>
                      {codeSpans(s).map((seg, j) =>
                        seg.code ? (
                          <CmdChip key={j} command={seg.text} />
                        ) : (
                          <span key={j}>{seg.text}</span>
                        ),
                      )}
                    </span>
                  </p>
                ))}
                {m.note && (
                  <p className="mt-0.5 italic text-muted/60">{m.note}</p>
                )}
              </div>
            )}
          </div>
        ))}
        <p className="mt-1 text-[11px] italic text-muted/60">
          a killer move is cast, never scheduled — the formations hold
          everything else.
        </p>
      </div>
    </>
  );
}

/**
 * A step's literal command as a chip, tap-to-copy (the needs-doing board's copy
 * idiom): the step already names what to run — the tap only removes the
 * retyping. Feedback appears solely on a copy that landed; a clipboard the
 * browser withholds leaves the plain chip.
 */
function CmdChip({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={`copy ${command}`}
      onClick={() =>
        navigator.clipboard?.writeText(command).then(
          () => setCopied(true),
          () => {},
        )
      }
      className="rounded-[2px] border border-hairline bg-surface px-[5px] text-[10px] text-fg/85 transition-colors hover:border-(--essence-soft)"
    >
      {copied ? <span className="text-up">copied ✓</span> : command}
    </button>
  );
}

/**
 * The eight sealed envelope stores of the aevcontext config family (fin,
 * transit, todo, totp, gym, meals, agenda, jobs) — the gu-house census's one
 * code constant. A ninth store bumps this by hand: the census is a colophon,
 * not an inventory system.
 */
const SEALED_STORES = 8;

/**
 * 府 — the gu house band, the page's colophon (canon: a gu house IS a
 * formation-path killer move, so it renders below 阵 and 杀 as the structure
 * they compose into). Nameplate, type line and origin all print off the seal
 * verbatim; the census beside the FIRST house (the hub itself) is derived from
 * counts already on the page — nothing fetched, nothing self-reported. Later
 * houses render as plain nameplates: only the house this page lives in gets
 * counted in its own gu. Never interactive, never a nag.
 */
function GuHouseBand({
  houses,
  formationsCount,
  movesCount,
  guHeld,
  rented,
}: {
  houses: ApertureGuHouse[];
  formationsCount: number;
  movesCount: number;
  guHeld: number;
  rented?: string[];
}) {
  return (
    <div className="border-t border-hairline">
      <ZoneHeader
        label="the gu house"
        seal="府"
        right={houses.length > 1 ? `${houses.length} standing` : undefined}
      />
      <div className="flex flex-col gap-4 border-b border-hairline px-4 py-3">
        {houses.map((h, i) => (
          <div key={h.name}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base text-fg">{h.name}</p>
                <p className="mt-0.5 text-[11px] text-muted">{h.type}</p>
              </div>
              <span
                aria-hidden
                lang="zh"
                className="shrink-0 font-[family-name:var(--font-zh)] text-[30px] leading-none text-(--essence) opacity-80"
              >
                宅
              </span>
            </div>
            <p className="mt-2 max-w-[60ch] text-[11px] leading-relaxed text-muted">
              {h.origin.join(" · ")}
            </p>
            {i === 0 && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <Stat
                    label="sealed stores"
                    value={`${SEALED_STORES}`}
                    tone="text-(--essence)"
                  />
                  <Stat
                    label="formations"
                    value={`${formationsCount} standing`}
                  />
                  <Stat
                    label="killer moves"
                    value={movesCount > 0 ? `${movesCount} named` : "—"}
                  />
                  <Stat label="gu held" value={`${guHeld}`} />
                </div>
                {rented && rented.length > 0 && (
                  <p className="mt-3 text-[11px] text-muted/75">
                    <span className="text-muted">essence supplied:</span> rented
                    — {rented.join(" · ")}
                  </p>
                )}
              </>
            )}
          </div>
        ))}
        <p className="text-[11px] italic text-muted/60">
          many gu, one effect — the house outlives every casting.
        </p>
      </div>
    </div>
  );
}

/**
 * 道 — the dao-mark composition (ADR 0167): every marks-bearing path in its OWN
 * unit, the sealed count with the live week beside it. No bars and no total —
 * different substances don't share an axis, and re-summing across units would
 * sneak the comparison back in. The only comparison the units permit is each
 * path against its own past (the record's job, seal by seal).
 */
function DaoBand({
  rows,
}: {
  rows: { name: string; count: number; unit: string; wk: number | null }[];
}) {
  return (
    <div className="border-t border-hairline">
      <ZoneHeader
        label="the dao"
        seal="道"
        right={`${rows.length} path${rows.length === 1 ? "" : "s"}`}
      />
      <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-2.5">
        {rows.map((r) => (
          <p
            key={r.name}
            className="flex items-baseline gap-2 text-xs tabular-nums"
          >
            <span className="w-[88px] shrink-0 truncate text-fg/90">
              {r.name}
            </span>
            <span className="shrink-0 text-fg">
              {r.count.toLocaleString("en-AU")}{" "}
              <span
                aria-hidden
                lang="zh"
                className="font-[family-name:var(--font-zh)] text-(--essence-soft)"
              >
                道
              </span>
            </span>
            <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted/60 sm:block">
              {r.unit}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted">
              {r.wk !== null && `+${r.wk} this wk`}
            </span>
          </p>
        ))}
        <p className="mt-1 text-[11px] italic text-muted/60">
          each path&apos;s marks in its own substance — never converted, never
          compared.
        </p>
      </div>
    </div>
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
  suffix,
  tone,
}: {
  label: string;
  value: string;
  /** What the figure is measured in or against (`g`, `/ 4`) — muted, so the
   *  figure stays the thing being read and the unit is only there when asked for. */
  suffix?: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted">
        {label}
      </p>
      <p className={`mt-0.5 text-sm tabular-nums ${tone ?? "text-fg/90"}`}>
        {value}
        {suffix && <span className="text-muted"> {suffix}</span>}
      </p>
    </div>
  );
}

/** A band's closing line: what the numbers above it MEAN, in the framework's own
 *  register. Muted and italic, so it never competes with a figure. */
function Flavor({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11px] italic text-muted/60">{children}</p>;
}

/**
 * One trend strip: what it is on the left, the ten-or-so readings across the
 * middle, where it started and ended on the right. Shared by the record's two
 * lists and the stones flow, so a change to the geometry can't leave one of them
 * behind — and the label column is wide enough for the longest counter name a
 * check-in has emitted.
 */
function TrendRow({
  label,
  values,
  delta,
  plot,
  right,
}: {
  label: string;
  values: number[];
  /** Sign decides the line's colour; always `last - first`. */
  delta: number;
  /** The sparkline's aria-label — what the strip is a picture of. */
  plot: string;
  right: string;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-24 shrink-0 truncate text-muted">{label}</span>
      <span className="min-w-0 flex-1">
        <Sparkline values={values} delta={delta} height={22} label={plot} />
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums text-muted/60">
        {right}
      </span>
    </div>
  );
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
      <PeakLine peak={path.peak} />
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
      <PeakLine peak={path.peak} />
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

/** How high the path goes — the ceiling, printed at the head of the card where
 *  `next` is printed at its foot: what it is worth reaching, then the next step
 *  toward it. Shared with the sub-path card for the same reason `NextLine` is. */
function PeakLine({ peak }: { peak?: string }) {
  if (!peak) return null;
  return (
    <p className="mt-1.5 text-[11px] text-muted">
      peak · <span className="text-fg/80">{peak}</span>
    </p>
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
