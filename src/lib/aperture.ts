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

/**
 * One gu a path holds — a named capability, its `type` open vocabulary like every
 * other enum-shaped field here. `bears` marks the one carrying the path's
 * attainment; the rest are held, not load-bearing.
 *
 * THE FEEDING CLOCK is `fed` + `interval`, and it is a PAIR: a day with no period
 * says nothing about hunger, and a period with no day has nothing to count from.
 * A LONE ONE IS DROPPED rather than rejected — a half-written feeding line is the
 * check-in's slip, and losing the whole document (every path, every trial, the
 * wall) over one gu's missing number would be the frame punishing the wrong
 * thing. A PRESENT field is still held to its type, so what survives normalize is
 * either a whole clock or no clock at all — never half of one. No clock is the
 * foundation state: a gu fed once that holds, which the page reads as silence
 * rather than as never-fed.
 */
export interface ApertureGu {
  name: string;
  type?: string;
  bears?: boolean;
  /** The day it was last fed, `YYYY-MM-DD`. Only meaningful with `interval`. */
  fed?: string;
  /** Whole days it goes between feedings — the clock's period. Only with `fed`. */
  interval?: number;
  /** A GitHub repo whose last push feeds it, named as GitHub spells it. Where the
   *  page can see that push it OVERRIDES `fed`: the repo's own history is better
   *  evidence than a day typed at the check-in a week ago. */
  repo?: string;
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
const MAX_KILLER_MOVES = 12;
const MAX_MOVE_STEPS = 12;
const MAX_STEP_CHARS = 400;
const MAX_GU_HOUSES = 8;
const MAX_ORIGIN_BEATS = 12;
const MAX_BEAT_CHARS = 400;
const MAX_INHERITANCES = 12;
const MAX_HELD_GU = 12;
const MAX_CASTS = 60;
const MAX_REFINING = 24;

/**
 * One true inheritance — a whole legacy, either RECEIVED (a source outside
 * yourself and what it handed down; an enlightenment is what you distilled, an
 * inheritance is what was handed to you) or LEFT BEHIND (the estate being
 * compiled for whoever passes the fair test). Adjudicated whole at the
 * check-in, printed verbatim, and slow-growing BY DESIGN: a true inheritance
 * is a few-per-life entry, and the check-in should refuse casual ones — the
 * band ought to look almost identical for years.
 */
export interface ApertureInheritance {
  /** Who or what handed it down — or, on the left side, the estate's name. */
  source: string;
  /** What it transmitted, one line — the collapsed row's summary. */
  gave: string;
  /** The unfolded passage, paragraphs printed verbatim (the harvest's
   *  bold-lead exception applies here too). Absent = the row is the entry. */
  body?: string[];
}

/** The band's two directions. `received` may be empty while `left` stands —
 *  a seal can describe the estate before the formative list is worded. */
export interface ApertureInheritances {
  received: ApertureInheritance[];
  left?: ApertureInheritance[];
}

/**
 * One gu house — a structure assembled from many gu whose combined effect
 * exceeds using them individually, persisting whether or not its master is
 * present (canon: a gu house IS a formation-path killer move, which is why the
 * band renders below 阵 and 杀 as the thing they compose into). Adjudicated
 * whole at the check-in and printed verbatim; the census the site draws beside
 * the FIRST house (the hub itself) is derived from counts already on the page.
 */
export interface ApertureGuHouse {
  /** The house's name, on the plate. */
  name: string;
  /** The type line, verbatim — "defensive type — storage and refinement · one
   *  master". Whole-prose on purpose: master-ship, specialty, grade are all the
   *  check-in's words, never site-computed. */
  type: string;
  /** The origin, one beat per entry — the site joins them with " · ". A later
   *  seal may append a beat (a rebuild, a migration): the passage grows the way
   *  the record grows seals. At least one — a house has a story or it isn't
   *  sealed yet. */
  origin: string[];
}

/**
 * One killer move — a named composite ritual, the active half of the formations
 * duality (阵 runs without the owner; a killer move is only ever CAST). The
 * definition is adjudicated whole at the check-in and printed verbatim; the only
 * thing the site adds beside it is a cast reading derived from evidence
 * (`apertureview.castReading`) — never a self-reported count.
 */
export interface ApertureKillerMove {
  /** The move's name, printed as the row. */
  name: string;
  /** The one-line component chain beside it — "csv → portfolio → seal". */
  chain: string;
  /** The unfolded casting, one step per line. A `` `backtick` `` span renders as
   *  a copy-on-tap command chip (`apertureview.codeSpans`); everything else
   *  prints literally. */
  steps: string[];
  /** Where the casting evidence lives — the seal record (count + age) or the
   *  backup stamp (age alone). Absent = the move leaves no trace, and the row
   *  says so honestly rather than inventing a beacon to self-report through. */
  evidence?: "record" | "backup";
  /** The honest line under the steps — what the reading can and cannot claim. */
  note?: string;
}

/**
 * One cast of a consumable — a spirit stone spent, and what it bought. `stones` is
 * CENTS, the hub's one money unit (the fin envelope's, the jobs ledger's), so a
 * month can be summed without the page ever guessing at a scale; absent = a cast
 * that cost nothing but the choosing.
 */
export interface ApertureCast {
  /** The day it was cast, `YYYY-MM-DD`. */
  date: string;
  /** What it bought, in the check-in's words. */
  name: string;
  /** What it cost, in cents. */
  stones?: number;
  /** Open vocabulary, like every other type line on this document. */
  type?: string;
}

/**
 * The consumables ledger: the share of what comes in that may be BURNED, and what
 * has been burned against it. `budgetPct` is a percentage of the week's recovered
 * income — the site multiplies and prints, and never rules on the share.
 *
 * The casts arrive in the emitter's writing order; newest-first is the PAGE's
 * reading, applied there the way the harvest's is.
 */
export interface ApertureConsumables {
  /** 0–100, the adjudicated allotment. */
  budgetPct: number;
  /** Every cast the seal carries — the page windows them to the month. */
  casts: ApertureCast[];
}

/**
 * One entry in the refinement queue — a gu being worked TOWARD, never one held.
 * Wholly adjudicated prose: what it would be, at what rank, what would prove it,
 * and what it still wants. Nothing here is inventory, which is why the band says
 * so under itself.
 */
export interface ApertureRefinement {
  name: string;
  /** The rank it would come out at — a word, open like every rung here. */
  rank: string;
  type: string;
  /** What would prove it — the yield test, in the check-in's words. */
  test: string;
  /** What is still missing. Absent = nothing named yet. */
  needs?: string;
}

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
  /** The named composite rituals — definitions sealed at the check-in, cast
   *  readings derived by the site from evidence. Absent on every document
   *  sealed before the band existed, and the band simply doesn't render. */
  killerMoves?: ApertureKillerMove[];
  /** The houses, first = the hub itself (it carries the derived census and
   *  absorbs the rented footnote as its essence line). Absent on every document
   *  sealed before the band existed. */
  guHouses?: ApertureGuHouse[];
  /** What was handed down and what is being left behind — sealed whole, and
   *  absent on every document sealed before the band existed. */
  inheritances?: ApertureInheritances;
  /** Gu belonging to no path — held by the house rather than by a road (the
   *  portfolio is the standing example). Absent on every document sealed before
   *  the compendium existed. */
  held?: ApertureGu[];
  /** The burn allotment and the casts against it. Absent on the same terms. */
  consumables?: ApertureConsumables;
  /** The refinement queue — the recipe book's open page. Absent on the same
   *  terms, and the band simply doesn't render. */
  refining?: ApertureRefinement[];
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
  const { type, bears, fed, interval, repo } = x;
  if (type !== undefined && !isStr(type)) return null;
  if (bears !== undefined && typeof bears !== "boolean") return null;
  if (fed !== undefined && !isDay(fed)) return null;
  // A period is whole days and at least one — a zero interval would make a gu
  // hungry the instant it was fed.
  if (interval !== undefined && !isPosInt(interval)) return null;
  // An empty repo name is absent-in-disguise (it can match no push), so it
  // rejects the way an empty `peak` line does.
  if (repo !== undefined && !isNonEmptyStr(repo)) return null;
  // The pairing rule (see the interface): a clock needs both hands, and a lone
  // hand is dropped rather than allowed to reject the document.
  const clock =
    fed !== undefined && interval !== undefined ? { fed, interval } : {};
  return {
    name: x.name,
    ...(type !== undefined ? { type } : {}),
    ...(bears !== undefined ? { bears } : {}),
    ...clock,
    ...(repo !== undefined ? { repo } : {}),
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

function normKillerMove(x: unknown): ApertureKillerMove | null {
  if (!isObj(x)) return null;
  if (!isProse(x.name, MAX_TITLE_CHARS) || !isProse(x.chain, MAX_TITLE_CHARS))
    return null;
  const steps = normArray(x.steps, (v) =>
    isProse(v, MAX_STEP_CHARS) ? v : null,
  );
  // A move with no steps is not a move — the unfold would be bare chrome.
  if (steps === null || steps.length === 0 || steps.length > MAX_MOVE_STEPS)
    return null;
  const { evidence, note } = x;
  // The evidence source is a CLOSED vocabulary: the site derives the reading
  // from it, so a value this build doesn't know is a frame breach, not data.
  if (evidence !== undefined && evidence !== "record" && evidence !== "backup")
    return null;
  if (note !== undefined && !isProse(note, MAX_STEP_CHARS)) return null;
  return {
    name: x.name,
    chain: x.chain,
    steps,
    ...(evidence !== undefined ? { evidence } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

function normInheritance(x: unknown): ApertureInheritance | null {
  if (!isObj(x)) return null;
  if (!isProse(x.source, MAX_TITLE_CHARS) || !isProse(x.gave, MAX_TITLE_CHARS))
    return null;
  const { body } = x;
  let bodyOut: string[] | undefined;
  if (body !== undefined) {
    const norm = normArray(body, (v) =>
      isProse(v, MAX_PARAGRAPH_CHARS) ? v : null,
    );
    // An EMPTY body is malformed rather than absent: a row either unfolds into
    // a passage or is the whole entry — a caret over nothing is bare chrome.
    if (norm === null || norm.length === 0 || norm.length > MAX_PARAGRAPHS)
      return null;
    bodyOut = norm;
  }
  return {
    source: x.source,
    gave: x.gave,
    ...(bodyOut !== undefined ? { body: bodyOut } : {}),
  };
}

function normInheritances(x: unknown): ApertureInheritances | null {
  if (!isObj(x)) return null;
  const received = normArray(x.received, normInheritance);
  if (received === null || received.length > MAX_INHERITANCES) return null;
  const left =
    x.left === undefined ? undefined : normArray(x.left, normInheritance);
  if (left === null) return null;
  if (left !== undefined && left.length > MAX_INHERITANCES) return null;
  return { received, ...(left !== undefined ? { left } : {}) };
}

function normGuHouse(x: unknown): ApertureGuHouse | null {
  if (!isObj(x)) return null;
  if (!isProse(x.name, MAX_TITLE_CHARS) || !isProse(x.type, MAX_TITLE_CHARS))
    return null;
  const origin = normArray(x.origin, (v) =>
    isProse(v, MAX_BEAT_CHARS) ? v : null,
  );
  if (
    origin === null ||
    origin.length === 0 ||
    origin.length > MAX_ORIGIN_BEATS
  )
    return null;
  return { name: x.name, type: x.type, origin };
}

function normCast(x: unknown): ApertureCast | null {
  if (!isObj(x)) return null;
  if (!isDay(x.date) || !isProse(x.name, MAX_TITLE_CHARS)) return null;
  const { stones, type } = x;
  // Cents, so a whole number ≥ 0: a fractional cent is not a price anyone paid,
  // and a negative cast is a refund this ledger has no shape for.
  if (stones !== undefined && !isNonNegInt(stones)) return null;
  if (type !== undefined && !isProse(type, MAX_TITLE_CHARS)) return null;
  return {
    date: x.date,
    name: x.name,
    ...(stones !== undefined ? { stones } : {}),
    ...(type !== undefined ? { type } : {}),
  };
}

function normConsumables(x: unknown): ApertureConsumables | null {
  if (!isObj(x)) return null;
  // A percentage, and one of a whole: outside 0–100 it is not a share of
  // anything, so it breaks the frame rather than multiplying into nonsense.
  if (!isFiniteNum(x.budgetPct) || x.budgetPct < 0 || x.budgetPct > 100)
    return null;
  const casts = normArray(x.casts, normCast);
  // An EMPTY list is a real ledger (a month with nothing burned); a MISSING one
  // is malformed, since the allotment alone is only half the reading.
  if (casts === null || casts.length > MAX_CASTS) return null;
  return { budgetPct: x.budgetPct, casts };
}

function normRefinement(x: unknown): ApertureRefinement | null {
  if (!isObj(x)) return null;
  if (
    !isProse(x.name, MAX_TITLE_CHARS) ||
    !isProse(x.rank, MAX_TITLE_CHARS) ||
    !isProse(x.type, MAX_TITLE_CHARS)
  )
    return null;
  // The test and what it still wants are the row's two prose lines — the killer
  // move's step ceiling, since they are read at the same width.
  if (!isProse(x.test, MAX_STEP_CHARS)) return null;
  const { needs } = x;
  if (needs !== undefined && !isProse(needs, MAX_STEP_CHARS)) return null;
  return {
    name: x.name,
    rank: x.rank,
    type: x.type,
    test: x.test,
    ...(needs !== undefined ? { needs } : {}),
  };
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
  const killerMoves =
    x.killerMoves === undefined
      ? undefined
      : normArray(x.killerMoves, normKillerMove);
  if (killerMoves === null) return null;
  if (killerMoves !== undefined && killerMoves.length > MAX_KILLER_MOVES)
    return null;
  const guHouses =
    x.guHouses === undefined ? undefined : normArray(x.guHouses, normGuHouse);
  if (guHouses === null) return null;
  if (guHouses !== undefined && guHouses.length > MAX_GU_HOUSES) return null;
  const inheritances =
    x.inheritances === undefined ? undefined : normInheritances(x.inheritances);
  if (inheritances === null) return null;
  const held = x.held === undefined ? undefined : normArray(x.held, normGu);
  if (held === null) return null;
  if (held !== undefined && held.length > MAX_HELD_GU) return null;
  const consumables =
    x.consumables === undefined ? undefined : normConsumables(x.consumables);
  if (consumables === null) return null;
  const refining =
    x.refining === undefined
      ? undefined
      : normArray(x.refining, normRefinement);
  if (refining === null) return null;
  if (refining !== undefined && refining.length > MAX_REFINING) return null;
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
    ...(killerMoves !== undefined ? { killerMoves } : {}),
    ...(guHouses !== undefined ? { guHouses } : {}),
    ...(inheritances !== undefined ? { inheritances } : {}),
    ...(held !== undefined ? { held } : {}),
    ...(consumables !== undefined ? { consumables } : {}),
    ...(refining !== undefined ? { refining } : {}),
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
