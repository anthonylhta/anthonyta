/**
 * aperture — the render-side data contract for the private status module.
 *
 * THE SITE RENDERS, NEVER ADJUDICATES. Every figure that arrives here (a streak's
 * count, a condition's status, a trial's outcome, the breakthrough wall) was
 * DECIDED elsewhere — by the owner-run sync script that seals the blob — and lands
 * already settled. The only site-side computation this module permits itself is
 * the essence canon lookup and the two freshness dot flags. Nothing here decides
 * whether a condition is held, whether a trial passed, or what a streak is worth.
 *
 * FRAME STRICT, VOCABULARY OPEN. The frame — version, shapes, types, required
 * fields — hard-rejects to null: a structurally wrong blob renders NOTHING rather
 * than half a panel of `undefined`. The vocabulary — stage names, condition
 * statuses, trial tiers, attainment rungs — is deliberately open: every
 * enum-valued field is typed `string`, and a value this build has never heard of
 * survives normalize AS THE LITERAL for the UI to render muted. That is the whole
 * forward-compat story — a newer emitter can ship a rung, a status, or a tier
 * ahead of the site without blanking the module — and the exported guards are how
 * a consumer branches known from unknown.
 *
 * Pure and env-less: no `next`, store, or `react` import, no Node-only API, and no
 * clock of its own (both dot rules take their instants as arguments). Safe in a
 * client component and unit-testable on its own, exactly like lib/fin and
 * lib/layout.
 *
 * The sealed blob has a SINGLE writer — the owner-run sync script, landing in a
 * later PR — so nothing here writes, merges, or migrates. Reading is the whole job.
 */

// --- closed vocabularies (the guards; the FIELDS themselves stay open) --------

/** The four sub-steps within a mortal rank. Immortal ranks have no stages. */
export type ApertureStage = "initial" | "middle" | "upper" | "peak";

/** How a condition stands right now — the sync script adjudicates, never the site. */
export type ConditionStatus =
  | "not_held"
  | "hardening"
  | "held"
  | "hardened"
  | "failing"
  | "suspended";

/** Where a trial sits: pending, banked for later, or already resolved. */
export type TrialState = "active" | "stocked" | "passed" | "failed";

/** A trial's weight class. */
export type TrialTier = "earthly" | "heavenly" | "grand";

/** A path's rung on the mastery ladder. */
export type Attainment =
  | "ordinary"
  | "quasi-master"
  | "master"
  | "quasi-grandmaster"
  | "grandmaster"
  | "quasi-great-grandmaster"
  | "great-grandmaster"
  | "quasi-supreme-grandmaster"
  | "supreme-grandmaster";

const STAGES: readonly ApertureStage[] = ["initial", "middle", "upper", "peak"];

const CONDITION_STATUSES: readonly ConditionStatus[] = [
  "not_held",
  "hardening",
  "held",
  "hardened",
  "failing",
  "suspended",
];

const TRIAL_STATES: readonly TrialState[] = [
  "active",
  "stocked",
  "passed",
  "failed",
];

const TRIAL_TIERS: readonly TrialTier[] = ["earthly", "heavenly", "grand"];

/** The nine attainment rungs, LOWEST → HIGHEST. The order is meaningful: the
 *  ladder renders in this sequence and a rung's index is its height. */
export const ATTAINMENTS = [
  "ordinary",
  "quasi-master",
  "master",
  "quasi-grandmaster",
  "grandmaster",
  "quasi-great-grandmaster",
  "great-grandmaster",
  "quasi-supreme-grandmaster",
  "supreme-grandmaster",
] as const;

/** Every vocabulary guard is this one shape: a string in a closed list. */
function inVocab<T extends string>(vocab: readonly T[], x: unknown): x is T {
  return typeof x === "string" && (vocab as readonly string[]).includes(x);
}

/** Whether `x` is a stage THIS build knows — anything else renders muted. */
export function isApertureStage(x: unknown): x is ApertureStage {
  return inVocab(STAGES, x);
}

/** Whether `x` is a condition status this build knows — anything else renders muted. */
export function isConditionStatus(x: unknown): x is ConditionStatus {
  return inVocab(CONDITION_STATUSES, x);
}

/** Whether `x` is a trial state this build knows — anything else renders muted. */
export function isTrialState(x: unknown): x is TrialState {
  return inVocab(TRIAL_STATES, x);
}

/** Whether `x` is a trial tier this build knows — anything else renders muted. */
export function isTrialTier(x: unknown): x is TrialTier {
  return inVocab(TRIAL_TIERS, x);
}

/** Whether `x` is an attainment rung this build knows — anything else renders muted. */
export function isAttainment(x: unknown): x is Attainment {
  return inVocab(ATTAINMENTS, x);
}

// --- the document shape -------------------------------------------------------

/** The part of the status that is never sealed — rank and stage carry the glance. */
export interface AperturePublic {
  rank: number;
  stage: string;
}

/** The plaintext glance blob: enough to draw the badge without an unlock. */
export interface ApertureGlance {
  v: 1;
  sealedAt: string;
  rank: number;
  stage: string;
}

/** One tracked streak. `state` is open vocabulary; the counters are adjudicated. */
export interface ApertureStreak {
  count: number;
  target: number;
  state: string;
  earliestHarden?: string;
  pausesThisQuarter?: number;
}

/** One condition and its progress toward hardening, in its own `unit`. */
export interface ApertureCondition {
  id: string;
  label: string;
  status: string;
  progress: number;
  target: number;
  unit: string;
}

/** One gu a path holds — a named capability, its `type` open vocabulary like every
 *  other enum-shaped field here. `bears` marks the one carrying the path's
 *  attainment; the rest are held, not load-bearing. */
export interface ApertureGu {
  name: string;
  type?: string;
  bears?: boolean;
}

/** One path. Sub-paths reuse the same shape — `role` only appears on top-level
 *  paths in practice, but the type deliberately doesn't forbid it on a sub. */
/**
 * A path's dao marks (ADR 0167): an ADJUDICATED cumulative total in the path's
 * OWN unit — commit days, sessions, days logged — never converted and never
 * compared across paths (different paths' marks are different substances; the
 * rev-1 uniform unit was rejected for weighing a passive walking day the same
 * as a day of craft). The check-in adds each week's evidence at the seal; the
 * site prints both fields verbatim.
 */
export interface ApertureMarks {
  count: number;
  /** What one mark IS for this path, in the check-in's words — "commit days". */
  unit: string;
}

export interface AperturePath {
  name: string;
  role?: string;
  attainment?: string;
  verified?: boolean;
  note?: string;
  activity?: string;
  /** How high this path can go and what it compounds into, in the check-in's own
   *  words — the ceiling, where `next` is the very next step toward it. */
  peak?: string;
  /** The gu the path holds. Absent on a path the check-in hasn't inventoried. */
  gu?: ApertureGu[];
  /** What the next rung asks for, in the emitter's own words. */
  next?: string;
  /** The path's dao marks — absent on a path the check-in hasn't opened a
   *  ledger for (and on every document sealed before the band existed). */
  marks?: ApertureMarks;
  sub?: AperturePath[];
}

/** The vital gu, if one is held: a named companion with its own rank ceiling.
 *  An UNNAMED vital gu (`name: ""`, `rank: 0`) is a real state, not a broken one —
 *  the aperture is open and nothing has been named into it yet. */
export interface ApertureVitalGu {
  name: string;
  rank: number;
  max: number;
  /** What is being weighed for the slot, while it is still unnamed. */
  candidates?: string[];
}

/** One trial. `date` is null while the outcome has no day attached to it yet. */
export interface ApertureTrial {
  name: string;
  tier: string;
  state: string;
  opened?: string;
  date?: string | null;
  provisioned?: boolean;
}

/** The wall currently being worked and what would break it. `recentStrikes` is an
 *  OPEN record on purpose — strike-counter names are DATA, not schema. */
export interface ApertureBreakthrough {
  wall: string;
  event: string;
  routes: string[];
  recentStrikes: Record<string, number>;
}

/**
 * One enlightenment — what a trial YIELDED, written up at the check-in and sealed
 * whole. `body` is the passage as paragraphs, carried across the frame untouched:
 * the site prints them and never parses them (the one exception is a `**bold**`
 * lead at the head of a paragraph, which `apertureview.splitLead` reads for
 * emphasis alone — everything else prints literally).
 *
 * `trial` names the trial the entry came out of, when it came out of one; an
 * enlightenment that arrived on its own terms simply doesn't carry it.
 */
export interface ApertureEnlightenment {
  /** The day it was written, `YYYY-MM-DD`. */
  date: string;
  title: string;
  trial?: string;
  /** At least one paragraph — an entry with no body is not an entry. */
  body: string[];
}

/** One adjudication the check-in made, in its own words and dated — the ledger of
 *  decisions behind the figures the rest of the page renders. */
export interface ApertureRuling {
  date: string;
  text: string;
}

/**
 * Ceilings on the two prose arrays. They are not a formatting opinion: this
 * document is decrypted and rendered in one pass in the browser, so a runaway
 * emission would be a page that takes seconds to draw rather than a line that
 * looks wrong. Over any of them is a HARD REJECT like every other frame breach —
 * the sync script's walk names which one, so an over-long check-in is caught at
 * seal time rather than at read time.
 */
const MAX_ENLIGHTENMENTS = 50;
const MAX_PARAGRAPHS = 60;
const MAX_PARAGRAPH_CHARS = 4000;
const MAX_TITLE_CHARS = 200;
const MAX_RULINGS = 30;
const MAX_RULING_CHARS = 4000;

/**
 * Standing context about the person the sheet is about. `born` is a `YYYY-MM-DD`
 * calendar day the browser turns into an age. (A `now` line was designed and cut
 * the same day — the age and the daily quote carry the block.)
 *
 * IT LIVES SEALED, deliberately: this repository is public and a
 * birth date is personal data, so the day itself never leaves the envelope and the
 * age is computed client-side from it (`apertureview.ageOn`) — the same bargain the
 * declared weekly burn keeps, where the figure the site divides by is one the server
 * never holds. The plaintext glance stays rank and stage alone.
 */
export interface ApertureProfile {
  born?: string;
}

/**
 * The soul — the second axis beside rank (a facet, never a path). Everything here
 * is ADJUDICATED: the check-in rules the grade and the gate, the site prints the
 * words verbatim and only ever computes the raw day count beside them (from the
 * vault index, client-side). The gate: a band cannot be crossed unrefined — count
 * touching `at` with `refined` false is the strained state, the detonation
 * gentled into refusal-to-advance.
 */
export interface ApertureSoul {
  /** The adjudicated grade word — "hundred man soul". */
  grade: string;
  /** The next grade word — "thousand man soul". */
  next: string;
  /** The recorded-day count at which the next band opens. */
  at: number;
  /** The gate's state: refinement seen this band. */
  refined: boolean;
  /** Enlightenments harvested this band — the refinement evidence count. */
  harvested: number;
  /** The crossing refused: the count touched `at` unrefined. */
  strained: boolean;
}

/** Everything behind the unlock. `streaks` is an open record keyed by streak name
 *  for the same reason as the strike counters: the names are data. */
export interface ApertureSealed {
  streaks: Record<string, ApertureStreak>;
  conditions: ApertureCondition[];
  paths: AperturePath[];
  vitalGu?: ApertureVitalGu;
  trials: ApertureTrial[];
  breakthrough: ApertureBreakthrough;
  /**
   * What the NEXT seal is waiting on, in the check-in's own words — the one
   * forward-facing line on a page that otherwise reads backward.
   *
   * Printed VERBATIM and never parsed. The site must never compute a stage: the
   * naive reading of the stage table ("two conditions of three") and the ruling
   * the check-in actually makes come apart regularly, and the check-in is the
   * only authority. So this is prose the emitter wrote, carried across the seal
   * untouched — absent on every document sealed before it existed, and absent
   * again whenever a week has nothing to say about what comes next.
   */
  next?: string;
  /** The harvest: what the trials yielded, newest first once the page has sorted
   *  them. Absent on every document sealed before the band existed. */
  enlightenments?: ApertureEnlightenment[];
  /** The decisions behind the figures, dated. Absent on the same terms. */
  rulings?: ApertureRuling[];
  /** Borrowed capability — what is rented rather than held, one line each. */
  rented?: string[];
  /** Who the sheet is about — absent on every document sealed before it existed. */
  profile?: ApertureProfile;
  /** The soul's standing — absent on every document sealed before the axis
   *  existed, and the band simply doesn't render. */
  soul?: ApertureSoul;
}

/** The decrypted aperture document — the panel's entire input. */
export interface ApertureDoc {
  v: 1;
  sealedAt: string;
  public: AperturePublic;
  sealed: ApertureSealed;
}

// --- normalize (never throws; unknown keys are DROPPED at every level) --------

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
/** An OPEN record, where the keys themselves are data. An array is not a record:
 *  its numeric keys must never smuggle through the open-record frame as `[1]` →
 *  `{"0": 1}`, which is coercion where the doctrine demands a hard reject. */
function isRecord(x: unknown): x is Record<string, unknown> {
  return isObj(x) && !Array.isArray(x);
}
function isStr(x: unknown): x is string {
  return typeof x === "string";
}
function isNonEmptyStr(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}
/** A finite number — no NaN, no Infinity, no string coercion. */
function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
/** A safe integer ≥ 1 — ranks start at 1 and there is no rank 0. */
function isPosInt(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x > 0;
}
/** A string an engine can actually turn into an instant. */
function isInstant(x: unknown): x is string {
  return typeof x === "string" && Number.isFinite(Date.parse(x));
}
/** A calendar DAY — `YYYY-MM-DD`, and one an engine can parse. Days and instants
 *  are different facts here (a birth date has no time of day), so they get
 *  different predicates rather than one loose `isInstant` covering both. */
const DAY_ISO = /^\d{4}-\d{2}-\d{2}$/;
function isDay(x: unknown): x is string {
  return (
    typeof x === "string" && DAY_ISO.test(x) && Number.isFinite(Date.parse(x))
  );
}

/** Rebuild an array field-for-field, rejecting the WHOLE array if any row is off
 *  shape — a half-rendered list is worse than an empty panel. */
function normArray<T>(x: unknown, norm: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(x)) return null;
  const out: T[] = [];
  for (const v of x) {
    const n = norm(v);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** Same discipline for an open record: the KEYS are data and survive untouched,
 *  the values must each normalize. */
function normRecord<T>(
  x: unknown,
  norm: (v: unknown) => T | null,
): Record<string, T> | null {
  if (!isRecord(x)) return null;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(x)) {
    const n = norm(v);
    if (n === null) return null;
    out[k] = n;
  }
  return out;
}

function normPublic(x: unknown): AperturePublic | null {
  if (!isObj(x)) return null;
  if (!isPosInt(x.rank) || !isNonEmptyStr(x.stage)) return null;
  return { rank: x.rank, stage: x.stage };
}

function normStreak(x: unknown): ApertureStreak | null {
  if (!isObj(x)) return null;
  if (!isFiniteNum(x.count) || !isFiniteNum(x.target)) return null;
  if (!isNonEmptyStr(x.state)) return null;
  const { earliestHarden, pausesThisQuarter } = x;
  if (earliestHarden !== undefined && !isStr(earliestHarden)) return null;
  if (pausesThisQuarter !== undefined && !isFiniteNum(pausesThisQuarter))
    return null;
  return {
    count: x.count,
    target: x.target,
    state: x.state,
    ...(earliestHarden !== undefined ? { earliestHarden } : {}),
    ...(pausesThisQuarter !== undefined ? { pausesThisQuarter } : {}),
  };
}

function normCondition(x: unknown): ApertureCondition | null {
  if (!isObj(x)) return null;
  if (!isStr(x.id) || !isStr(x.label) || !isStr(x.unit)) return null;
  if (!isNonEmptyStr(x.status)) return null;
  if (!isFiniteNum(x.progress) || !isFiniteNum(x.target)) return null;
  return {
    id: x.id,
    label: x.label,
    status: x.status,
    progress: x.progress,
    target: x.target,
    unit: x.unit,
  };
}

function normGu(x: unknown): ApertureGu | null {
  if (!isObj(x)) return null;
  if (!isStr(x.name)) return null;
  const { type, bears } = x;
  if (type !== undefined && !isStr(type)) return null;
  if (bears !== undefined && typeof bears !== "boolean") return null;
  return {
    name: x.name,
    ...(type !== undefined ? { type } : {}),
    ...(bears !== undefined ? { bears } : {}),
  };
}

/** A list of plain strings, whole-array reject on one bad row — the `routes`
 *  discipline, reused by the gu candidates and the rented lines. */
function normStrings(x: unknown): string[] | null {
  return normArray(x, (v) => (isStr(v) ? v : null));
}

function normMarks(x: unknown): ApertureMarks | null {
  if (!isObj(x)) return null;
  // Zero is a real ledger ("beginning to cultivate the dao"), so ≥ 0.
  if (!isNonNegInt(x.count) || !isNonEmptyStr(x.unit)) return null;
  return { count: x.count, unit: x.unit };
}

function normPath(x: unknown): AperturePath | null {
  if (!isObj(x)) return null;
  if (!isStr(x.name)) return null;
  const { role, attainment, verified, note, activity, peak, gu, next, sub } = x;
  if (role !== undefined && !isStr(role)) return null;
  if (attainment !== undefined && !isStr(attainment)) return null;
  if (verified !== undefined && typeof verified !== "boolean") return null;
  if (note !== undefined && !isStr(note)) return null;
  if (activity !== undefined && !isStr(activity)) return null;
  // The peak is a printed LINE, not a label: an empty one would render as a bare
  // "peak ·" with nothing after it, so it is absent-in-disguise and rejects — the
  // same reading the sealed `next` line gets.
  if (peak !== undefined && !isNonEmptyStr(peak)) return null;
  if (next !== undefined && !isStr(next)) return null;
  const gus = gu === undefined ? undefined : normArray(gu, normGu);
  if (gus === null) return null;
  const marks = x.marks === undefined ? undefined : normMarks(x.marks);
  if (marks === null) return null;
  const subs = sub === undefined ? undefined : normArray(sub, normPath);
  if (subs === null) return null;
  return {
    name: x.name,
    ...(role !== undefined ? { role } : {}),
    ...(attainment !== undefined ? { attainment } : {}),
    ...(verified !== undefined ? { verified } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(activity !== undefined ? { activity } : {}),
    ...(peak !== undefined ? { peak } : {}),
    ...(gus !== undefined ? { gu: gus } : {}),
    ...(next !== undefined ? { next } : {}),
    ...(marks !== undefined ? { marks } : {}),
    ...(subs !== undefined ? { sub: subs } : {}),
  };
}

function normVitalGu(x: unknown): ApertureVitalGu | null {
  if (!isObj(x)) return null;
  if (!isStr(x.name)) return null;
  if (!isFiniteNum(x.rank) || !isFiniteNum(x.max)) return null;
  const candidates =
    x.candidates === undefined ? undefined : normStrings(x.candidates);
  if (candidates === null) return null;
  return {
    name: x.name,
    rank: x.rank,
    max: x.max,
    ...(candidates !== undefined ? { candidates } : {}),
  };
}

function normProfile(x: unknown): ApertureProfile | null {
  if (!isObj(x)) return null;
  const { born } = x;
  // Both fields are optional, and a PRESENT one is held to its type — a birth day
  // that isn't a day rejects the document rather than reaching `ageOn` as junk.
  if (born !== undefined && !isDay(born)) return null;
  return {
    ...(born !== undefined ? { born } : {}),
  };
}

function normTrial(x: unknown): ApertureTrial | null {
  if (!isObj(x)) return null;
  if (!isStr(x.name)) return null;
  if (!isNonEmptyStr(x.tier) || !isNonEmptyStr(x.state)) return null;
  const { opened, date, provisioned } = x;
  if (opened !== undefined && !isStr(opened)) return null;
  if (date !== undefined && date !== null && !isStr(date)) return null;
  if (provisioned !== undefined && typeof provisioned !== "boolean")
    return null;
  return {
    name: x.name,
    tier: x.tier,
    state: x.state,
    ...(opened !== undefined ? { opened } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(provisioned !== undefined ? { provisioned } : {}),
  };
}

/** Prose with a ceiling: non-empty, and short enough that the page can draw it. */
function isProse(x: unknown, max: number): x is string {
  return isNonEmptyStr(x) && x.length <= max;
}

function normEnlightenment(x: unknown): ApertureEnlightenment | null {
  if (!isObj(x)) return null;
  if (!isDay(x.date)) return null;
  if (!isProse(x.title, MAX_TITLE_CHARS)) return null;
  const { trial } = x;
  // The title and the paragraphs are printed as the entry; the trial name is
  // printed only when there is one, so an empty one is silence, not bare chrome.
  if (trial !== undefined && !isStr(trial)) return null;
  const body = normArray(x.body, (v) =>
    isProse(v, MAX_PARAGRAPH_CHARS) ? v : null,
  );
  if (body === null || body.length === 0 || body.length > MAX_PARAGRAPHS)
    return null;
  return {
    date: x.date,
    title: x.title,
    ...(trial !== undefined ? { trial } : {}),
    body,
  };
}

function normRuling(x: unknown): ApertureRuling | null {
  if (!isObj(x)) return null;
  if (!isDay(x.date) || !isProse(x.text, MAX_RULING_CHARS)) return null;
  return { date: x.date, text: x.text };
}

function normBreakthrough(x: unknown): ApertureBreakthrough | null {
  if (!isObj(x)) return null;
  if (!isStr(x.wall) || !isStr(x.event)) return null;
  const routes = normStrings(x.routes);
  if (routes === null) return null;
  const recentStrikes = normRecord(x.recentStrikes, (v) =>
    isFiniteNum(v) ? v : null,
  );
  if (recentStrikes === null) return null;
  return { wall: x.wall, event: x.event, routes, recentStrikes };
}

/** A safe integer ≥ 0 — harvested can honestly be zero. */
function isNonNegInt(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

function normSoul(x: unknown): ApertureSoul | null {
  if (!isObj(x)) return null;
  if (!isNonEmptyStr(x.grade) || !isNonEmptyStr(x.next)) return null;
  if (!isPosInt(x.at) || !isNonNegInt(x.harvested)) return null;
  if (typeof x.refined !== "boolean" || typeof x.strained !== "boolean")
    return null;
  return {
    grade: x.grade,
    next: x.next,
    at: x.at,
    refined: x.refined,
    harvested: x.harvested,
    strained: x.strained,
  };
}

function normSealed(x: unknown): ApertureSealed | null {
  if (!isObj(x)) return null;
  const streaks = normRecord(x.streaks, normStreak);
  const conditions = normArray(x.conditions, normCondition);
  const paths = normArray(x.paths, normPath);
  const trials = normArray(x.trials, normTrial);
  const breakthrough = normBreakthrough(x.breakthrough);
  if (!streaks || !conditions || !paths || !trials || !breakthrough)
    return null;
  // Absent optional → stays absent; PRESENT-but-malformed → hard reject.
  const vitalGu = x.vitalGu === undefined ? undefined : normVitalGu(x.vitalGu);
  if (vitalGu === null) return null;
  const rented = x.rented === undefined ? undefined : normStrings(x.rented);
  if (rented === null) return null;
  // The two prose arrays: one bad row rejects the whole list (normArray), and a
  // list past its ceiling rejects the document.
  const enlightenments =
    x.enlightenments === undefined
      ? undefined
      : normArray(x.enlightenments, normEnlightenment);
  if (enlightenments === null) return null;
  if (
    enlightenments !== undefined &&
    enlightenments.length > MAX_ENLIGHTENMENTS
  )
    return null;
  const rulings =
    x.rulings === undefined ? undefined : normArray(x.rulings, normRuling);
  if (rulings === null) return null;
  if (rulings !== undefined && rulings.length > MAX_RULINGS) return null;
  const profile = x.profile === undefined ? undefined : normProfile(x.profile);
  if (profile === null) return null;
  const soul = x.soul === undefined ? undefined : normSoul(x.soul);
  if (soul === null) return null;
  // An EMPTY next line is malformed rather than absent: a seal either says what
  // it waits on or says nothing, and a blank string would render as bare chrome.
  const { next } = x;
  if (next !== undefined && !isNonEmptyStr(next)) return null;
  return {
    streaks,
    conditions,
    paths,
    ...(vitalGu !== undefined ? { vitalGu } : {}),
    trials,
    breakthrough,
    ...(next !== undefined ? { next } : {}),
    ...(enlightenments !== undefined ? { enlightenments } : {}),
    ...(rulings !== undefined ? { rulings } : {}),
    ...(rented !== undefined ? { rented } : {}),
    ...(profile !== undefined ? { profile } : {}),
    ...(soul !== undefined ? { soul } : {}),
  };
}

/**
 * A decrypted aperture blob → a document, or null when the FRAME is wrong. Only
 * `v === 1` exists, so any other version is a hard reject — there is no widening
 * branch to fall back to yet. Unknown keys are dropped by rebuilding the document
 * field for field at every level (the anti-smuggling discipline `normalizeKeystore`
 * uses): nothing a compromised store bolts on can ride into the panel. Never throws.
 */
export function normalizeAperture(x: unknown): ApertureDoc | null {
  if (!isObj(x) || x.v !== 1 || !isInstant(x.sealedAt)) return null;
  const pub = normPublic(x.public);
  const sealed = normSealed(x.sealed);
  if (!pub || !sealed) return null;
  return { v: 1, sealedAt: x.sealedAt, public: pub, sealed };
}

/**
 * The plaintext glance blob → a glance, or null on a wrong frame. Same rebuild
 * discipline as the sealed document; the badge draws from this alone before any
 * unlock, so a malformed glance must render nothing rather than a broken badge.
 */
export function normalizeApertureGlance(x: unknown): ApertureGlance | null {
  if (!isObj(x) || x.v !== 1 || !isInstant(x.sealedAt)) return null;
  if (!isPosInt(x.rank) || !isNonEmptyStr(x.stage)) return null;
  return { v: 1, sealedAt: x.sealedAt, rank: x.rank, stage: x.stage };
}

// --- essence canon (colour is DERIVED from rank + stage, NEVER stored) --------

/** The five mortal ranks — each has four stages. */
export type MortalRank = 1 | 2 | 3 | 4 | 5;
/** The four immortal ranks — above the mortal ceiling there are no stages. */
export type ImmortalRank = 6 | 7 | 8 | 9;

/**
 * Mortal essence colour by rank and stage. Typed as a TOTAL record over both
 * vocabularies, so a missing cell is a tsc error, never an `undefined` the panel
 * would draw as a blank swatch. Nothing stores a colour beside a rank — the pair
 * (rank, stage) is the only truth and the colour is looked up from it.
 */
export const MORTAL_ESSENCE: Record<
  MortalRank,
  Record<ApertureStage, string>
> = {
  1: {
    initial: "Jade Green",
    middle: "Pale Green",
    upper: "Dark Green",
    peak: "Black Green",
  },
  2: {
    initial: "Light Red",
    middle: "Scarlet",
    upper: "Crimson",
    peak: "Dark Red",
  },
  3: {
    initial: "Light Silver",
    middle: "Blossom Silver",
    upper: "Bright Silver",
    peak: "Snow Silver",
  },
  4: {
    initial: "Light Gold",
    middle: "Bright Gold",
    upper: "Essence Gold",
    peak: "True Gold",
  },
  5: {
    initial: "Light Purple",
    middle: "Violet",
    upper: "Deep Purple",
    peak: "Crystal Purple",
  },
};

/** Immortal essence colour by rank. Stageless by canon — one colour per rank. */
export const IMMORTAL_ESSENCE: Record<ImmortalRank, string> = {
  6: "Green Grape",
  7: "Red Date",
  8: "White Litchi",
  9: "Yellow Apricot",
};

function isMortalRank(x: number): x is MortalRank {
  return Number.isInteger(x) && x >= 1 && x <= 5;
}
function isImmortalRank(x: number): x is ImmortalRank {
  return Number.isInteger(x) && x >= 6 && x <= 9;
}

/**
 * The canon essence colour for a rank (and, below the immortal line, a stage).
 * An immortal rank IGNORES the stage entirely — it has none. Null means "no canon
 * entry": the caller renders the literal rank/stage muted rather than inventing a
 * colour, which is also what happens the day the emitter ships a rank ahead of us.
 */
export function essenceOf(rank: number, stage?: string | null): string | null {
  if (isImmortalRank(rank)) return IMMORTAL_ESSENCE[rank];
  if (!isMortalRank(rank) || !isApertureStage(stage)) return null;
  return MORTAL_ESSENCE[rank][stage];
}

// --- freshness dots (the ONLY two site-side judgements; clock injected) -------

const DAY_MS = 86_400_000;

/**
 * Whether raw journal activity has run ≥2 days past the seal — the adjudication
 * dot. FLAG, NEVER RESOLVE: it says the sealed picture is behind the raw days, it
 * does NOT guess what those days would have decided. `latestRawDay` is the newest
 * raw activity day (`YYYY-MM-DD`, which parses as UTC midnight); null means there
 * is no raw activity to be behind. Anything unparseable is false — a broken date
 * must never light a dot.
 */
export function isAdjudicationPending(
  sealedAt: string,
  latestRawDay: string | null,
): boolean {
  if (latestRawDay === null) return false;
  const sealed = Date.parse(sealedAt);
  const raw = Date.parse(latestRawDay);
  if (!Number.isFinite(sealed) || !Number.isFinite(raw)) return false;
  return raw - sealed >= 2 * DAY_MS;
}

/**
 * Whether the seal itself is older than 9 days — the staleness dot. Strictly
 * greater, so a seal exactly 9 days old is still fresh. `nowMs` is injected (this
 * module owns no clock); an unparseable `sealedAt` is false, never a lit dot.
 */
export function isSealStale(sealedAt: string, nowMs: number): boolean {
  const sealed = Date.parse(sealedAt);
  if (!Number.isFinite(sealed)) return false;
  return nowMs - sealed > 9 * DAY_MS;
}
