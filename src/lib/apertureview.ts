import {
  isApertureStage,
  type ApertureAlmanacEntry,
  type AperturePath,
  type ApertureCast,
  type ApertureCondition,
  type ApertureDoc,
  type ApertureGu,
  type ApertureRefinement,
  type ApertureStage,
  type ApertureStreak,
  type ApertureTrial,
} from "./aperture";
import { audCompact } from "./money";

/**
 * apertureview — the pure view spine of the character sheet: the inward reading on
 * /aperture, and the me-block that opens the door to it. Every decision those
 * components make lives here: which of the six island states to render, which
 * literal Tailwind class a colour or a status wears, how a date turns into a
 * countdown or a birth day into an age, what a band's right-hand summary says,
 * which trials collapse behind the "+n" toggle. The components are thin JSX over
 * these values and hold no branching logic of their own.
 *
 * That split is the house testing discipline, not an abstraction for its own sake:
 * vitest runs node-env here, so a component's behaviour is only testable once it is
 * a function over data (`money.tone`, `chores.choreState` are the precedents). The
 * "component tests" for this module are `apertureview.test.ts`.
 *
 * Two rules the whole file obeys:
 *   - EVERY class is a static literal string. Tailwind's JIT scans source text, so
 *     a computed `text-${token}` would compile to nothing and render invisible —
 *     the TftStrip `CELL` pattern, applied to a 24-entry canon.
 *   - Anything this build doesn't recognise renders MUTED, never dropped and never
 *     dressed as known. lib/aperture keeps its vocabularies open on purpose; this
 *     is the other half of that bargain.
 *
 * Pure and clock-less like lib/aperture: every time-dependent function takes its
 * instant as an argument (the `isSealStale` discipline).
 */

const DAY_MS = 86_400_000;

// --- the island's six states --------------------------------------------------

/** The detail island's entire state space — one branch of its render, each. */
export type ApertureDetailStatus =
  | "offline"
  | "sealed"
  | "decrypting"
  | "unreachable"
  | "tamper"
  | "ready";

/**
 * Which state the detail island is in, given the vault machine's status, whatever
 * went wrong fetching the document, and the document itself. Precedence is
 * load-bearing: "offline" beats everything (with crypto off entirely there is
 * nothing to unlock toward, so no error is worth reporting), and a data error only
 * counts once the vault is actually unlocked — a fetch that failed while locked is
 * a stale fact about a state the owner has already left.
 */
export function detailStatus(
  vaultStatus: string,
  dataErr: "unreachable" | "tamper" | null,
  doc: ApertureDoc | null,
): ApertureDetailStatus {
  if (vaultStatus === "offline") return "offline";
  if (vaultStatus !== "unlocked") return "sealed";
  if (doc) return "ready";
  if (dataErr) return dataErr;
  return "decrypting";
}

// --- the essence canon, as classes --------------------------------------------

/**
 * Canon essence name → the literal text class over its @theme token. Keyed by the
 * exact strings `essenceOf` returns; the test iterates the canon tables so adding
 * a rank without a colour token fails there rather than rendering an invisible
 * name in production.
 */
export const ESSENCE_TEXT: Record<string, string> = {
  "Jade Green": "text-jade-green",
  "Pale Green": "text-pale-green",
  "Dark Green": "text-dark-green",
  "Black Green": "text-black-green",
  "Light Red": "text-light-red",
  Scarlet: "text-scarlet",
  Crimson: "text-crimson",
  "Dark Red": "text-dark-red",
  "Light Silver": "text-light-silver",
  "Blossom Silver": "text-blossom-silver",
  "Bright Silver": "text-bright-silver",
  "Snow Silver": "text-snow-silver",
  "Light Gold": "text-light-gold",
  "Bright Gold": "text-bright-gold",
  "Essence Gold": "text-essence-gold",
  "True Gold": "text-true-gold",
  "Light Purple": "text-light-purple",
  Violet: "text-violet",
  "Deep Purple": "text-deep-purple",
  "Crystal Purple": "text-crystal-purple",
  "Green Grape": "text-green-grape",
  "Red Date": "text-red-date",
  "White Litchi": "text-white-litchi",
  "Yellow Apricot": "text-yellow-apricot",
};

/** The class every unknown thing wears — one literal, one doctrine. */
const MUTED = "text-muted";

/** A canon name's text class; no canon (or a name this build never heard of)
 *  renders muted rather than picking a colour nobody assigned. */
export function essenceTextClass(name: string | null): string {
  return (name && ESSENCE_TEXT[name]) || MUTED;
}

/**
 * The same canon a third way: the class that DECLARES the sheet's `--essence`
 * variable (the cultivation skin's one input — ADR 0118). Set once on the sheet
 * container; every essence-tinted border, wash, strip and glyph below consumes
 * the variable instead of naming a colour. Arbitrary-property classes are still
 * static literals, so the JIT rule above holds.
 */
export const ESSENCE_VAR: Record<string, string> = {
  "Jade Green": "[--essence:var(--color-jade-green)]",
  "Pale Green": "[--essence:var(--color-pale-green)]",
  "Dark Green": "[--essence:var(--color-dark-green)]",
  "Black Green": "[--essence:var(--color-black-green)]",
  "Light Red": "[--essence:var(--color-light-red)]",
  Scarlet: "[--essence:var(--color-scarlet)]",
  Crimson: "[--essence:var(--color-crimson)]",
  "Dark Red": "[--essence:var(--color-dark-red)]",
  "Light Silver": "[--essence:var(--color-light-silver)]",
  "Blossom Silver": "[--essence:var(--color-blossom-silver)]",
  "Bright Silver": "[--essence:var(--color-bright-silver)]",
  "Snow Silver": "[--essence:var(--color-snow-silver)]",
  "Light Gold": "[--essence:var(--color-light-gold)]",
  "Bright Gold": "[--essence:var(--color-bright-gold)]",
  "Essence Gold": "[--essence:var(--color-essence-gold)]",
  "True Gold": "[--essence:var(--color-true-gold)]",
  "Light Purple": "[--essence:var(--color-light-purple)]",
  Violet: "[--essence:var(--color-violet)]",
  "Deep Purple": "[--essence:var(--color-deep-purple)]",
  "Crystal Purple": "[--essence:var(--color-crystal-purple)]",
  "Green Grape": "[--essence:var(--color-green-grape)]",
  "Red Date": "[--essence:var(--color-red-date)]",
  "White Litchi": "[--essence:var(--color-white-litchi)]",
  "Yellow Apricot": "[--essence:var(--color-yellow-apricot)]",
};

/** The skin's `--essence` declaration for a canon name. Off canon the essence IS
 *  muted — the unknown-renders-muted doctrine as a variable — so the skin's
 *  chrome stays legible without ever inventing a colour. */
export function essenceVarClass(name: string | null): string {
  return (name && ESSENCE_VAR[name]) || "[--essence:var(--color-muted)]";
}

/**
 * The metal-tier NAME of each mortal rank's essence — the layer of the canon
 * above the 20 stage shades (rank 1's Jade→Black Green are the shades of Green
 * Copper essence, and so on). Immortal ranks aren't here: their essence has one
 * name and `essenceOf` already returns it, so a family line would only repeat it.
 */
export const ESSENCE_FAMILY: Record<
  1 | 2 | 3 | 4 | 5,
  { en: string; zh: string }
> = {
  1: { en: "Green Copper", zh: "青铜" },
  2: { en: "Red Steel", zh: "赤铁" },
  3: { en: "White Silver", zh: "白银" },
  4: { en: "Yellow Gold", zh: "黄金" },
  5: { en: "Purple Crystal", zh: "紫晶" },
};

/** A rank's essence family, or null above the mortal ceiling (and off canon). */
export function familyOf(rank: number): { en: string; zh: string } | null {
  if (!Number.isInteger(rank) || rank < 1 || rank > 5) return null;
  return ESSENCE_FAMILY[rank as 1 | 2 | 3 | 4 | 5];
}

/** The left gutter's vertical phrase — the essence family as qi (青铜之气). Null
 *  where there is no family to name, and the gutter simply stays a stroke. */
export function gutterPhrase(rank: number): string | null {
  const family = familyOf(rank);
  return family === null ? null : `${family.zh}之气`;
}

// --- condition chips -----------------------------------------------------------

/** The neutral chip: unknown statuses AND the two known statuses that must not
 *  imply anything is going wrong. */
const MUTED_CHIP = "border-hairline text-muted";

const CONDITION_CHIP: Record<string, string> = {
  not_held: MUTED_CHIP,
  // The three healthy statuses wear the sheet's essence (the cultivation skin's
  // variable, declared on the container) in a ladder: hardening a soft border,
  // held a full one, hardened the full border plus the faint wash — permanence
  // earns the fill. Failing keeps the house red — bad news must not change
  // colour with the rank.
  hardening: "border-(--essence-soft) text-(--essence)",
  held: "border-(--essence) text-(--essence)",
  hardened: "border-(--essence) bg-(--essence-faint) text-(--essence)",
  failing: "border-down/50 text-down",
  // The tribulation exemption, honoured in CSS: a SUSPENDED condition was paused
  // by the adjudicator, not broken by the owner, so it must never wear a `down`
  // (red) class — red here would read as failure and be a lie every time. It keeps
  // the neutral COLOUR and says its piece in shape instead: a dashed border, plus
  // the ⏸ prefix below.
  suspended: "border-hairline border-dashed text-muted",
};

/** A condition status's chip class; an unknown status gets the muted chip. */
export function conditionChipClass(status: string): string {
  return CONDITION_CHIP[status] ?? MUTED_CHIP;
}

/** The glyph that opens a chip — only `suspended` gets one, because it is the one
 *  status whose colour deliberately says nothing. */
export function conditionChipPrefix(status: string): string {
  return status === "suspended" ? "⏸ " : "";
}

/** How a status reads on its chip. Only the one snake_case value in the vocabulary
 *  is respelled; every other status — known or not — prints as its own literal. */
export function conditionStatusWord(status: string): string {
  return status === "not_held" ? "not held" : status;
}

/**
 * The conditions band's right-hand summary: what is WORST first, at most two
 * segments ("1 failing · 1 suspended"). Worst-first because the header is read
 * before the chips are, and a band that leads with "3 held" while one condition is
 * failing has buried the only thing worth acting on. Statuses this build has never
 * heard of sort last but still get a segment when there is room — the summary
 * abbreviates, and abbreviating must never be how an unknown status disappears.
 */
const SUMMARY_ORDER: readonly string[] = [
  "failing",
  "suspended",
  "hardening",
  "not_held",
  "held",
  "hardened",
];

/** How many segments the summary shows before it stops — two reads at a glance. */
const SUMMARY_SEGMENTS = 2;

export function conditionsSummary(conditions: ApertureCondition[]): string {
  const counts = new Map<string, number>();
  for (const c of conditions)
    counts.set(c.status, (counts.get(c.status) ?? 0) + 1);

  const known = SUMMARY_ORDER.filter((s) => counts.has(s));
  const unknown = [...counts.keys()].filter((s) => !SUMMARY_ORDER.includes(s));
  return [...known, ...unknown]
    .slice(0, SUMMARY_SEGMENTS)
    .map((s) => `${counts.get(s)} ${conditionStatusWord(s)}`)
    .join(" · ");
}

// --- path evidence -------------------------------------------------------------

/** Where a path's activity series comes from, and how its evidence reads. */
export interface ActivitySeries {
  /** Where the per-day series comes from — usually the connector behind it (the
   *  `getX`), but a SEALED source names its own store instead and is derived in
   *  the browser, because the server cannot see it to draw it. */
  source: string;
  /** The site's caption for the strip — the emitter's word for the series is the
   *  KEY, this is what the sheet prints next to it. */
  label: string;
  /** How the number beside the strip reads: a WEEK's movement (`+12`) or the
   *  latest day's absolute COUNT (`8,423`). */
  mode: "delta" | "count";
  /** The word after the number, empty when the number speaks for itself. */
  unit: string;
}

/**
 * `paths[].activity` → the series that becomes that path's evidence strip. The
 * document names a series in the emitter's own words (the field is open, like
 * every other vocabulary in lib/aperture), so this map is the site's side of the
 * bargain: the names it can actually draw. A name that isn't here reads as
 * `undefined` and the path renders with NO strip — never a blank one, and never a
 * reason to drop the path itself. Three for now, the ones the document claims;
 * reading, riichi and tft each already have a per-day series on the sheet, so
 * widening this is one line per series the day a path names one.
 *
 * `gym` and `meals` are the SEALED series here, and the reason `source` no longer
 * means "connector": their days live in E2EE envelopes, so the server that renders
 * the other three cannot produce them. The island decrypts each and merges it in
 * (ApertureInner) — the entries are still needed here, because being in this map
 * is what makes a path's `activity: "gym"` (or `"meals"`) drawable at all.
 *
 * Typed with `undefined` in the value so a lookup can't be mistaken for a hit —
 * `noUncheckedIndexedAccess` is off in this project, and the whole contract here
 * is that most keys MISS.
 */
export const ACTIVITY_SERIES: Readonly<
  Record<string, ActivitySeries | undefined>
> = Object.freeze(
  // Null prototype: `activity: "toString"` has to MISS like any other name the map
  // doesn't carry. An inherited method resolving as a descriptor would be exactly
  // the unknown-dressed-as-known this module refuses.
  Object.assign(Object.create(null) as Record<string, ActivitySeries>, {
    commits: {
      source: "github",
      label: "commits",
      mode: "delta",
      unit: "commits",
    },
    languages: {
      source: "translator",
      label: "languages",
      mode: "delta",
      unit: "",
    },
    steps: { source: "steps", label: "steps", mode: "count", unit: "steps" },
    gym: { source: "gym", label: "sessions", mode: "delta", unit: "sessions" },
    // Protein, not kcal: it is the macro the meal log accents everywhere else,
    // and the day's count reads against a target the way a step count does.
    meals: { source: "meals", label: "protein", mode: "count", unit: "g" },
  }),
);

/** Per-series evidence for a path row: the strip's levels and the one number beside
 *  it (a week's movement, or the latest day's count — `ActivitySeries.mode` says
 *  which). `null` value = measured but nothing to show, which renders as a dash. */
export interface EvidenceSeries {
  levels: number[];
  value: number | null;
}

/** The assembled evidence, keyed by the same names `paths[].activity` uses. Open by
 *  design: a series the page doesn't carry is simply absent, and the row renders
 *  bare rather than showing empty chrome. Built on the SERVER from the connectors
 *  (commits, languages, steps) and handed to the inward page; the one sealed series
 *  (gym) is merged in by the browser, because the server cannot see it to draw it. */
export type PathSeries = Readonly<Record<string, EvidenceSeries | undefined>>;

/**
 * What a path row carries on its right. A `strip` is one of the series above; the
 * `wealth` row is the one exception, because its figure is the SITE's own — the
 * decrypted fin envelope (ADR 0061), not a per-day series any connector emits — so
 * it renders as a total with a month-to-date arrow instead of a heatmap.
 */
export type PathEvidence =
  | { kind: "strip"; key: string; series: ActivitySeries }
  | { kind: "wealth" }
  | null;

/** The one path the sheet knows by NAME as well as by declaration — see below. */
const WEALTH = "wealth";

/**
 * A path's evidence, or null for none at all. Precedence: a declared series the
 * sheet can draw, then the wealth figure, then nothing. A path naming a series this
 * build has never heard of gets NO evidence — never an empty strip, and never a
 * reason to drop the path.
 *
 * Wealth is recognised from `activity: "wealth"` OR from the path's own name, which
 * is a deliberate asymmetry: every other series is the emitter's to declare because
 * only the emitter knows which connector it means, whereas the wealth figure comes
 * from the hub's own envelope either way. Matching the name too means the row shows
 * the money whether or not the document thought to point at it.
 */
export function pathEvidence(path: AperturePath): PathEvidence {
  const key = path.activity;
  if (key !== undefined) {
    const series = ACTIVITY_SERIES[key];
    if (series) return { kind: "strip", key, series };
    if (key.trim().toLowerCase() === WEALTH) return { kind: "wealth" };
  }
  if (path.name.trim().toLowerCase() === WEALTH) return { kind: "wealth" };
  return null;
}

/** Every gu held across the paths, sub-paths included — the gu-house census's
 *  one figure the page didn't already have as a length. Uninventoried paths
 *  (no `gu` array) count nothing rather than guessing. */
export function guHeldCount(paths: AperturePath[]): number {
  let n = 0;
  for (const p of paths) {
    n += p.gu?.length ?? 0;
    if (p.sub) n += guHeldCount(p.sub);
  }
  return n;
}

// --- the gu compendium ---------------------------------------------------------

/**
 * A gu's feeding state. Three words and no fourth: a gu is either inside its own
 * period, past it, or so far past it that it has gone dormant — the "rock" the
 * compendium dims rather than flags. NOTHING here is a nag: hunger is a reading,
 * and the page prints it muted like every other fact on it.
 */
export type FeedingState = "fed" | "hungry" | "hibernating";

/** A feeding state with the count behind it, so the page can print both. */
export interface FeedingRead {
  state: FeedingState;
  /** Whole days since the last feeding, floored at 0 (a push stamped later today
   *  still reads as today, never as a gu fed in the future). */
  days: number;
}

/** How many periods past the last feeding a gu is before it is a rock. Three,
 *  so a weekly gu goes dormant after three weeks — long enough that a busy
 *  fortnight never reads as abandonment. */
const HIBERNATE_PERIODS = 3;

// en-CA formats as YYYY-MM-DD. A push instant is UTC and `today` is a SYDNEY
// calendar day, so the instant is read onto the same calendar before the two are
// subtracted — otherwise a push made this morning in Sydney reads a day old.
const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
});

/**
 * What a gu's clock says, or null when it has none — a foundation gu (fed once,
 * holds) is silence on the page, never "never fed".
 *
 * `repoPushedAt` is the OVERRIDE: where a gu names a repo and the page can see
 * that repo's last push, the push is the feeding, because a repo's own history is
 * better evidence than a day typed at a check-in. An unparseable or unknown push
 * falls back to the sealed day rather than voiding the clock.
 */
export function feedingState(
  gu: ApertureGu,
  todayISO: string,
  repoPushedAt?: string | null,
): FeedingRead | null {
  const { fed, interval } = gu;
  if (fed === undefined || interval === undefined) return null;
  let anchor = fed;
  if (gu.repo !== undefined && repoPushedAt) {
    const t = Date.parse(repoPushedAt);
    if (Number.isFinite(t)) anchor = SYDNEY_DAY.format(t);
  }
  const gap = dayGap(anchor, todayISO);
  if (gap === null) return null;
  const days = Math.max(0, -gap);
  if (days <= interval) return { state: "fed", days };
  return days <= interval * HIBERNATE_PERIODS
    ? { state: "hungry", days }
    : { state: "hibernating", days };
}

/**
 * The feeding read as the compendium prints it — "fed 2d", "hungry 33d", and for
 * a dormant gu the noun rather than the verb: "rock · 67d unfed". A rock is a
 * state of the gu, not a failure of the owner, so it is named as a thing.
 */
export function feedingLabel(read: FeedingRead): string {
  if (read.state === "hibernating") return `rock · ${read.days}d unfed`;
  return `${read.state} ${read.days}d`;
}

/** The strip's reading of one gu — the group row's dot, drawn from the SAME
 *  read the unfolded row prints, so the two can never disagree. `bears` inks the
 *  dot essence; `ring` hollows it once the clock is past its interval; `rock`
 *  dims it whole, the way the row dims. A foundation gu (no clock) is a filled
 *  dot: fed once, holds. */
export function feedingDot(read: GuRead): {
  bears: boolean;
  ring: boolean;
  rock: boolean;
} {
  const state = read.feeding?.state;
  return {
    bears: read.gu.bears === true,
    ring: state === "hungry" || state === "hibernating",
    rock: state === "hibernating",
  };
}

/**
 * The almanac windowed to today (ADR 0174). A dated feed is RIPE while today
 * sits inside its window, NEXT while its window opens within the next sixty
 * days, and otherwise off the page — a closed window simply leaves, and a far
 * one waits in the seal. A feed with no window is ambient: any week. Nothing is
 * counted against anything; the almanac is a menu, and the only sort is that
 * free feeds print first within each group — canon's arithmetic (cheap food
 * beats good food), stable otherwise.
 */
export interface AlmanacRead {
  entry: ApertureAlmanacEntry;
  /** "until 30 nov" for a ripe feed, "from 15 oct" for a coming one, "" for
   *  an ambient one. */
  when: string;
}
export interface AlmanacGroups {
  ripe: AlmanacRead[];
  next: AlmanacRead[];
  ambient: AlmanacRead[];
}
const NEXT_WINDOW_DAYS = 60;
const MONTH_WORDS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** `2026-11-30` → "30 nov". */
function dayWord(iso: string): string {
  const month = MONTH_WORDS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7);
  return `${Number(iso.slice(8, 10))} ${month}`;
}

/**
 * Where today falls against an entry's window. A recurring window is read as
 * its occurrences around today (last year's, this year's, next year's — a
 * window that wraps the new year opens in one year and closes in the next);
 * a one-off is itself. ISO days compare as strings, so containment needs no
 * clock; only the "opens within sixty days" read counts days.
 */
function almanacWindow(
  entry: ApertureAlmanacEntry,
  todayISO: string,
): { state: "ripe" | "next" | "off"; opens: string; closes: string } | null {
  const { from, to } = entry;
  if (from === undefined || to === undefined) return null;
  const year = Number(todayISO.slice(0, 4));
  let occurrences: [string, string][];
  if (from.length === 5) {
    const wraps = to < from;
    occurrences = [year - 1, year, year + 1].map((y) => [
      `${y}-${from}`,
      `${wraps ? y + 1 : y}-${to}`,
    ]);
  } else occurrences = [[from, to]];
  for (const [opens, closes] of occurrences)
    if (opens <= todayISO && todayISO <= closes)
      return { state: "ripe", opens, closes };
  let best: { gap: number; opens: string; closes: string } | null = null;
  for (const [opens, closes] of occurrences) {
    const gap = dayGap(opens, todayISO);
    if (gap === null) return null;
    if (gap > 0 && gap <= NEXT_WINDOW_DAYS && (best === null || gap < best.gap))
      best = { gap, opens, closes };
  }
  return best === null
    ? { state: "off", opens: "", closes: "" }
    : { state: "next", opens: best.opens, closes: best.closes };
}

export function almanacGroups(
  entries: ApertureAlmanacEntry[],
  todayISO: string,
): AlmanacGroups {
  const groups: AlmanacGroups = { ripe: [], next: [], ambient: [] };
  for (const entry of entries) {
    const w = almanacWindow(entry, todayISO);
    // An unreadable window (null from a day the engine can't parse) reads as
    // ambient rather than losing the line — the feeding clock's lenience.
    if (w === null) groups.ambient.push({ entry, when: "" });
    else if (w.state === "ripe")
      groups.ripe.push({ entry, when: `until ${dayWord(w.closes)}` });
    else if (w.state === "next")
      groups.next.push({ entry, when: `from ${dayWord(w.opens)}` });
  }
  const freeFirst = (list: AlmanacRead[]) => [
    ...list.filter((r) => r.entry.free === true),
    ...list.filter((r) => r.entry.free !== true),
  ];
  return {
    ripe: freeFirst(groups.ripe),
    next: freeFirst(groups.next),
    ambient: freeFirst(groups.ambient),
  };
}

/** One gu as the compendium reads it: the sealed entry and its clock. */
export interface GuRead {
  gu: ApertureGu;
  /** Null for a foundation gu — no clock, so no state to print. */
  feeding: FeedingRead | null;
}

/** One block of the compendium: a path (or sub-path) and the gu it holds. */
export interface GuBlock {
  /** The node's name, a sub-path qualified by its parent — the blocks are read
   *  flat, so "craft · the hub" has to carry where it sits. */
  name: string;
  attainment?: string;
  gu: GuRead[];
}

/** Look one repo's last push out of the connector's map. `Object.hasOwn`, because
 *  the keys are repo names — data — and `constructor` must miss, not find. */
function pushAt(
  pushes: Record<string, string>,
  repo: string | undefined,
): string | undefined {
  // `pushes` may be missing when a cached connector read predates the field —
  // a missing map reads as no push known, never a throw on the client.
  if (!pushes || repo === undefined || !Object.hasOwn(pushes, repo))
    return undefined;
  return pushes[repo];
}

/** A sealed gu list with each entry's clock read against today. */
export function guReads(
  gu: ApertureGu[] | undefined,
  todayISO: string,
  pushes: Record<string, string>,
): GuRead[] {
  return (gu ?? []).map((g) => ({
    gu: g,
    feeding: feedingState(g, todayISO, pushAt(pushes, g.repo)),
  }));
}

/**
 * The compendium's blocks, depth-first: every path and sub-path that actually
 * HOLDS gu, in seal order, parents before their children. A node with no gu is
 * not a block — an empty inventory would be chrome around nothing — but its
 * children are still walked, so a sub-path's gu can never be lost behind an
 * uninventoried parent.
 */
export function guBlocks(
  paths: AperturePath[],
  todayISO: string,
  pushes: Record<string, string>,
): GuBlock[] {
  const out: GuBlock[] = [];
  const walk = (list: AperturePath[], parent: string | null) => {
    for (const p of list) {
      const name = parent === null ? p.name : `${parent} · ${p.name}`;
      if (p.gu && p.gu.length > 0)
        out.push({
          name,
          ...(p.attainment !== undefined ? { attainment: p.attainment } : {}),
          gu: guReads(p.gu, todayISO, pushes),
        });
      if (p.sub) walk(p.sub, name);
    }
  };
  walk(paths, null);
  return out;
}

/**
 * The header's inventory: how many gu are held, and how many of those are rocks.
 * INVENTORY, never alarm — the count of hungry gu is deliberately not here, since
 * a number of hungry things at the top of a page is a nag by another name.
 */
export function guCensus(
  blocks: GuBlock[],
  held: GuRead[],
): { total: number; rocks: number } {
  const all = [...blocks.flatMap((b) => b.gu), ...held];
  return {
    total: all.length,
    rocks: all.filter((r) => r.feeding?.state === "hibernating").length,
  };
}

/**
 * This week's burn allotment in cents — the recovered income times the sealed
 * share. Null when nothing came in this week, which is the honest answer during a
 * week with no income rather than a budget of zero the page made up.
 */
export function experienceBudget(
  recoveredThisWeek: number | null,
  budgetPct: number,
): number | null {
  if (recoveredThisWeek === null || !Number.isFinite(budgetPct)) return null;
  return Math.round((recoveredThisWeek * budgetPct) / 100);
}

/**
 * The casts inside today's month, newest first, and what they cost together. The
 * month is `today`'s own — the page anchors on the Sydney day, so the window
 * turns over at Sydney midnight like every other reading here. Casts with no
 * `stones` cost nothing, which is a real cast (a day off the road), not a gap.
 */
export function castsThisMonth(
  casts: ApertureCast[],
  todayISO: string,
): { casts: ApertureCast[]; stones: number } {
  const month = todayISO.slice(0, 7);
  const inMonth = casts
    .filter((c) => c.date.slice(0, 7) === month)
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    casts: inMonth,
    stones: inMonth.reduce((sum, c) => sum + (c.stones ?? 0), 0),
  };
}

// --- the cast ledger (ADR 0176) --------------------------------------------------

/** One cast as the ledger reads it: the cast itself, its running number in
 *  display order, and the month header it sits under. */
export interface LedgerEntry {
  cast: ApertureCast;
  /** 1-based running number, newest first — a position, not an id. */
  n: number;
  /** `YYYY-MM`, the grouping key. */
  month: string;
  /** The header's word for that month: "sep 2026". */
  monthLabel: string;
}

export type LedgerRow =
  | { kind: "header"; label: string; count: number; stones: number }
  | { kind: "cast"; entry: LedgerEntry };

/** "YYYY-MM" → "sep 2026", in the almanac's month words. */
export function ledgerMonthLabel(month: string): string {
  const word = MONTH_WORDS[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7);
  return `${word} ${month.slice(0, 4)}`;
}

/**
 * Every cast in display order — newest day first, the seal's own order within
 * a day — and numbered in that order. The whole record, not a window: the
 * ledger is read by the page, so nothing is dropped for being old.
 */
export function ledgerEntries(casts: readonly ApertureCast[]): LedgerEntry[] {
  return casts
    .map((cast, i) => ({ cast, i }))
    .sort((a, b) => b.cast.date.localeCompare(a.cast.date) || a.i - b.i)
    .map((r, idx) => {
      const month = r.cast.date.slice(0, 7);
      return {
        cast: r.cast,
        n: idx + 1,
        month,
        monthLabel: ledgerMonthLabel(month),
      };
    });
}

/**
 * One page of the ledger: `per` casts with a month header wherever the month
 * changes — repeated at the top of a page that continues a month — each header
 * carrying the month's count and stones. The FIRST page opens on today's month
 * even when nothing has been cast in it: the running month is always there to
 * be read, so the ledger never reads as empty and never as owed.
 */
export function ledgerPage(
  entries: readonly LedgerEntry[],
  page: number,
  todayISO: string,
  per = BOOK_PAGE,
): LedgerRow[] {
  const totals = new Map<string, { count: number; stones: number }>();
  for (const e of entries) {
    const t = totals.get(e.month) ?? { count: 0, stones: 0 };
    t.count += 1;
    t.stones += e.cast.stones ?? 0;
    totals.set(e.month, t);
  }
  const out: LedgerRow[] = [];
  let last: string | null = null;
  const thisMonth = todayISO.slice(0, 7);
  if (page === 0 && entries[0]?.month !== thisMonth) {
    out.push({
      kind: "header",
      label: ledgerMonthLabel(thisMonth),
      count: 0,
      stones: 0,
    });
    last = thisMonth;
  }
  for (const entry of entries.slice(page * per, (page + 1) * per)) {
    if (entry.month !== last) {
      const t = totals.get(entry.month) ?? { count: 0, stones: 0 };
      out.push({
        kind: "header",
        label: entry.monthLabel,
        count: t.count,
        stones: t.stones,
      });
      last = entry.month;
    }
    out.push({ kind: "cast", entry });
  }
  return out;
}

// --- the book (ADR 0175) ---------------------------------------------------------

/** One entry of the gu book as the page reads it: the sealed row plus the
 *  effective start (the seal's `since`, else the site's own mark). */
export interface BookEntry {
  entry: ApertureRefinement;
  /** 1-based running number in display order — a position, not an id. */
  n: number;
  /** The rank's leading number for grouping; a rank with no number sorts last. */
  rankKey: number;
  /** The group header this entry sits under: "rank 1", or the rank's own word. */
  rankLabel: string;
  since: string | null;
  /** True when the start came from the mark store rather than the seal. */
  unsealed: boolean;
}

/** The marks the page overlays on the seal — the shape lib/gumarks stores. */
export interface BookMarks {
  [name: string]: { since?: string; cast?: { date: string } } | undefined;
}

/** Ten to a page: the old-school menu's fixed window. */
export const BOOK_PAGE = 10;

/** The rank's leading number, or +∞ for a rank that is only a word. */
export function bookRankKey(rank: string): number {
  const m = /^\s*(\d+)/.exec(rank);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function bookRankLabel(rank: string, key: number): string {
  return Number.isFinite(key) ? `rank ${key}` : rank.trim();
}

/**
 * The book in display order: by rank, then entries being refined before the
 * merely known, then the seal's own order — and numbered in that order. An
 * entry with an unsealed CAST is not in the book at all: on the site it has
 * already left for the month's casts, and Wednesday's seal will agree.
 */
export function bookEntries(
  refining: readonly ApertureRefinement[],
  marks: BookMarks = {},
): BookEntry[] {
  const rows = refining
    .map((entry, i) => {
      const mark = marks[entry.name];
      const since = entry.since ?? mark?.since ?? null;
      return {
        entry,
        i,
        since,
        unsealed: entry.since === undefined && since !== null,
        cast: mark?.cast !== undefined,
        rankKey: bookRankKey(entry.rank),
      };
    })
    .filter((r) => !r.cast)
    .sort(
      (a, b) =>
        a.rankKey - b.rankKey ||
        Number(a.since === null) - Number(b.since === null) ||
        a.i - b.i,
    );
  return rows.map((r, idx) => ({
    entry: r.entry,
    n: idx + 1,
    rankKey: r.rankKey,
    rankLabel: bookRankLabel(r.entry.rank, r.rankKey),
    since: r.since,
    unsealed: r.unsealed,
  }));
}

export type BookRow =
  | { kind: "header"; label: string; count: number }
  | { kind: "entry"; entry: BookEntry };

/** How many pages a book of `total` entries fills — never zero, so an empty
 *  window still has a page to stand on. */
export function bookPageCount(total: number, per = BOOK_PAGE): number {
  return Math.max(1, Math.ceil(total / per));
}

/**
 * One page of the book: its `per` entries with a group header wherever the
 * rank changes — repeated at the top of a page whose first entry continues a
 * rank from the page before, so no page opens without saying where it is.
 * Headers ride outside the count; a page is ten ENTRIES.
 */
export function bookPage(
  entries: readonly BookEntry[],
  page: number,
  per = BOOK_PAGE,
): BookRow[] {
  const counts = new Map<string, number>();
  for (const e of entries)
    counts.set(e.rankLabel, (counts.get(e.rankLabel) ?? 0) + 1);
  const out: BookRow[] = [];
  let last: string | null = null;
  for (const entry of entries.slice(page * per, (page + 1) * per)) {
    if (entry.rankLabel !== last) {
      out.push({
        kind: "header",
        label: entry.rankLabel,
        count: counts.get(entry.rankLabel) ?? 0,
      });
      last = entry.rankLabel;
    }
    out.push({ kind: "entry", entry });
  }
  return out;
}

/** The status line's left half, in the pager's idiom: "1-10/20 · 50%". */
export function bookStatus(
  total: number,
  page: number,
  per = BOOK_PAGE,
): string {
  if (total === 0) return "0/0";
  const lo = page * per + 1;
  const hi = Math.min(total, (page + 1) * per);
  return `${lo}-${hi}/${total} · ${Math.round((hi / total) * 100)}%`;
}

/** The band header's right half: what is known, and how much of it is moving. */
export function bookCounts(entries: readonly BookEntry[]): {
  known: number;
  refining: number;
} {
  return {
    known: entries.length,
    refining: entries.filter((e) => e.since !== null).length,
  };
}

/**
 * Every series key the document's paths actually ask for, sub-paths included.
 * The sheet uses this to decide what is worth FETCHING: a sealed series costs a
 * request and a decrypt, so it is only loaded when some path points at it. Keys
 * this build can't draw are not included — an undrawable name is not a reason to
 * go looking for data.
 */
export function declaredSeriesKeys(paths: AperturePath[]): Set<string> {
  const keys = new Set<string>();
  const walk = (list: AperturePath[]) => {
    for (const p of list) {
      const ev = pathEvidence(p);
      if (ev?.kind === "strip") keys.add(ev.key);
      if (p.sub) walk(p.sub);
    }
  };
  walk(paths);
  return keys;
}

/** A movement, always signed — `+12`, `0` reads as `+0` (a week that ran flat is
 *  still a week that was measured). */
export function signedCount(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * A path's id on the inward page — `craft`, `the body` → `the-body`. Lives here
 * rather than beside either surface because BOTH ends have to agree: the sheet's
 * path rows link at `/aperture#<id>` and the page's cards carry it. Two copies of
 * this one line is exactly how a door starts opening onto nothing.
 */
export function pathAnchor(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

// --- dates ---------------------------------------------------------------------

/**
 * Whole CALENDAR days from `todayISO` to `dateISO` — positive ahead, negative past,
 * zero for the day itself. Floored against `todayISO`'s midnight, so a timestamp
 * later today still reads 0 while anything before that midnight reads at least −1.
 * Null on anything unparseable at either end: a broken date must never become a
 * number. The day anchor is injected, like every clock in this module.
 */
export function dayGap(dateISO: string, todayISO: string): number | null {
  const t = Date.parse(dateISO);
  const today = Date.parse(todayISO);
  if (!Number.isFinite(t) || !Number.isFinite(today)) return null;
  return Math.floor((t - today) / DAY_MS);
}

/** A calendar day split into its three numbers, or null when the string is not one.
 *  The round-trip through `Date.UTC` is what makes it strict: `2001-02-31` matches
 *  the shape and even parses, but it is not a day anyone was born on. */
function parseDay(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  )
    return null;
  return { y, m: mo, d };
}

/**
 * Whole years elapsed from a birth day to a given day — the me-block's age. The
 * birthday itself counts (one is 24 ON the day, not the day after) and a birthday
 * still ahead in the year does not, which is why this compares month and day rather
 * than dividing elapsed milliseconds: a division by 365.25 drifts a day every leap
 * year and would print the wrong age for a week around every February.
 *
 * Both ends are `YYYY-MM-DD` CALENDAR days, and null on anything either end can't
 * parse as one — an age is a fact about calendars, and a broken date must never
 * become a number (the doctrine every date function here keeps).
 */
export function ageOn(bornISO: string, todayISO: string): number | null {
  const born = parseDay(bornISO);
  const today = parseDay(todayISO);
  if (born === null || today === null) return null;
  const beforeBirthday =
    today.m < born.m || (today.m === born.m && today.d < born.d);
  return today.y - born.y - (beforeBirthday ? 1 : 0);
}

/** How close a date has to be for the sheet to raise its voice about it. */
const IMMINENT_DAYS = 7;

/**
 * Whether a date is close enough to shout about — today or within the next week.
 * A date that has already gone by is NOT imminent: it is late, which the row says
 * in words ("2 days ago") rather than in amber.
 */
export function isImminent(
  dateISO: string | null | undefined,
  todayISO: string,
): boolean {
  if (dateISO === null || dateISO === undefined) return false;
  const gap = dayGap(dateISO, todayISO);
  return gap !== null && gap >= 0 && gap <= IMMINENT_DAYS;
}

/**
 * A trial's day in words: "today", "in 1 day", "in N days", and — once the day has
 * gone by — "N days ago". A stocked trial past its date is shown HONESTLY rather
 * than quietly dropped or dressed as still upcoming. Null for no date at all and
 * for anything unparseable, both of which leave the copy to the caller
 * ("unscheduled"); a broken date must never render as a number.
 *
 * Anchored on a DAY, not an instant (`dayGap` above): `todayISO` is the Sydney
 * calendar day, where `sealedAgo` takes a clock — calendar days are what a trial
 * actually has.
 */
export function trialCountdown(
  dateISO: string | null | undefined,
  todayISO: string,
): string | null {
  if (dateISO === null || dateISO === undefined) return null;
  const days = dayGap(dateISO, todayISO);
  if (days === null) return null;
  if (days === 0) return "today";
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/**
 * How long an active trial has been open — "25d" — or null when there is no
 * opened date, when it won't parse, or when it is dated AHEAD of today. A trial
 * cannot have been open for a negative number of days, and printing "-3d" beside
 * a row would be the site inventing a fact about a typo.
 */
export function daysOpen(
  openedISO: string | undefined,
  todayISO: string,
): string | null {
  if (openedISO === undefined) return null;
  const gap = dayGap(openedISO, todayISO);
  if (gap === null || gap > 0) return null;
  return `${-gap}d`;
}

/** Past a fortnight a resolved trial reads in weeks: "3 weeks ago" is the unit a
 *  person actually thinks in, where "97d ago" is arithmetic to be done. */
const AGO_WEEK_DAYS = 14;

/**
 * How long ago a resolved trial settled — "5d ago" inside a fortnight, "12w ago"
 * past it (floored, so a strip of weeks never rounds up into one it hasn't
 * finished). Null for no date, an unparseable one, or a date still ahead: a trial
 * resolved in the future is not a fact this page will print.
 */
export function agoLabel(
  dateISO: string | null | undefined,
  todayISO: string,
): string | null {
  if (dateISO === null || dateISO === undefined) return null;
  const gap = dayGap(dateISO, todayISO);
  if (gap === null || gap > 0) return null;
  const days = -gap;
  return days < AGO_WEEK_DAYS ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}

/**
 * How long ago the seal was taken — "sealed today" under a full day, "sealed 3d
 * ago" past it (floored: the elapsed days actually completed). Null on an
 * unparseable seal, so the band shows no age rather than a wrong one.
 */
export function sealedAgo(sealedAt: string, nowMs: number): string | null {
  const t = Date.parse(sealedAt);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((nowMs - t) / DAY_MS);
  return days < 1 ? "sealed today" : `sealed ${days}d ago`;
}

/** Elapsed days from an instant as a short age — "today" under one full day,
 *  then Nd/Nw ago (the `agoLabel` register, floored the way `sealedAgo` floors).
 *  Null on nothing, the unparseable, or an instant still ahead of the clock. */
function elapsedLabel(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((nowMs - t) / DAY_MS);
  if (days < 0) return null;
  if (days < 1) return "today";
  return days < AGO_WEEK_DAYS ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}

/**
 * A killer move's right-hand reading, derived ONLY from evidence the move's
 * declared source actually holds (the band's whole doctrine — nothing here is
 * self-reported):
 *   - "record": one dated seal per cast, so the archive count IS the cast count,
 *     aged by the current seal. A dead listing (total 0) drops the count rather
 *     than claiming zero casts; a broken age drops the age.
 *   - "backup": the stamp holds one date, so the reading is an age alone —
 *     casts stay honestly uncounted until the script learns to count.
 *   - absent: a pure read writes nothing, and the row says so.
 */
export function castReading(
  evidence: "record" | "backup" | undefined,
  ev: { recordTotal: number; sealedAt: string; backupAt: string | null },
  nowMs: number,
): string {
  if (evidence === "record") {
    const age = elapsedLabel(ev.sealedAt, nowMs);
    if (ev.recordTotal > 0)
      return `cast ${ev.recordTotal}${age ? ` · ${age}` : ""}`;
    return age ?? "—";
  }
  if (evidence === "backup")
    return elapsedLabel(ev.backupAt, nowMs) ?? "no record";
  return "leaves no trace";
}

/** One rendered run of a killer-move step: literal text, or a command chip. */
export interface CodeSpan {
  code: boolean;
  text: string;
}

/**
 * Split a step on `` `backtick` `` pairs — the killer-move steps' one piece of
 * markup, so a literal command can render (and copy) as a chip inside prose the
 * site otherwise never parses. An unmatched final backtick stays literal text:
 * a half-open span must render as what was written, never as a runaway chip.
 */
export function codeSpans(text: string): CodeSpan[] {
  const parts = text.split("`");
  if (parts.length % 2 === 0) {
    const tail = parts.pop() as string;
    parts[parts.length - 1] += "`" + tail;
  }
  const out: CodeSpan[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue;
    out.push({ code: i % 2 === 1, text: parts[i] });
  }
  return out;
}

// en-US short month over UTC: harden dates are bare Sydney calendar days, and
// formatting the UTC-midnight they parse to preserves the written day.
const HARDEN_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * A streak's harden date in the meta line's register: "hardens ~aug 12". The ~
 * is honest — the date slips automatically with any pause, so it is an earliest,
 * never a promise. Null on anything unparseable; a broken date must never render
 * as a wrong day.
 */
export function hardenLabel(dateISO: string): string | null {
  const t = Date.parse(dateISO);
  if (!Number.isFinite(t)) return null;
  return `hardens ~${HARDEN_DAY.format(t).toLowerCase()}`;
}

/**
 * The line under the condition chips: one segment per streak still working toward
 * its target and carrying an earliest-harden date — "finance · hardens ~aug 30".
 *
 * A streak already AT its target is left out on purpose: its date is history, and
 * a chip that already reads "hardened" needs no forecast under it. So is a streak
 * whose date won't parse — the same rule every date function here keeps.
 *
 * The names are data (the open streak record), so the walk is `Object.keys` in the
 * emitter's own order with `Object.hasOwn` behind it: a streak named `toString`
 * has to read off the seal, not off Object.prototype.
 */
export function hardenLines(streaks: Record<string, ApertureStreak>): string[] {
  const lines: string[] = [];
  for (const name of Object.keys(streaks)) {
    if (!Object.hasOwn(streaks, name)) continue;
    const s = streaks[name];
    if (s.earliestHarden === undefined || s.count >= s.target) continue;
    const label = hardenLabel(s.earliestHarden);
    if (label !== null) lines.push(`${name} · ${label}`);
  }
  return lines;
}

// --- figures at a strip's width -------------------------------------------------

/** Below this many dollars the cents are noise beside a sparkline and the whole
 *  figure fits anyway, so it reads unshortened. */
const COMPACT_FLOOR = 1000;

/**
 * A cents figure at the width the end of a trend row has for it — "$820", "$1.3k".
 * Under a thousand dollars it reads as whole dollars (the exact figure is in the
 * stats grid three lines above; this cell only has to say which way ten weeks
 * went), and above it defers to the site's one compaction rule.
 */
export function compactDollars(cents: number): string {
  const dollars = cents / 100;
  return Math.abs(dollars) < COMPACT_FLOOR
    ? `$${Math.round(dollars)}`
    : audCompact(dollars);
}

// --- trials --------------------------------------------------------------------

/**
 * Split trials into what is still live and what is settled. An UNKNOWN state
 * lands in `open`, deliberately: resolved trials collapse behind a toggle, so
 * treating an unrecognised state as resolved would HIDE it — and the one thing
 * the open vocabulary must never do is make a newer emitter's trial disappear.
 */
export function splitTrials(trials: ApertureTrial[]): {
  open: ApertureTrial[];
  resolved: ApertureTrial[];
} {
  const isResolved = (t: ApertureTrial) =>
    t.state === "passed" || t.state === "failed";
  return {
    open: trials.filter((t) => !isResolved(t)),
    resolved: trials.filter(isResolved),
  };
}

/**
 * The trials band's right-hand summary, over the OPEN trials only (resolved ones sit
 * behind their own toggle): "1 active · 1 stocked", or — once a stocked trial is
 * within the week — "1 in 3 days". A single stocked trial reads AS its countdown,
 * because with one there is nothing to count; several keep the count and name the
 * nearest. Anything neither active nor stocked is tallied as "open" rather than
 * folded into a state it doesn't hold: an unknown state must not vanish from the
 * header any more than it vanishes from the rows.
 */
export function trialsSummary(open: ApertureTrial[], todayISO: string): string {
  const active = open.filter((t) => t.state === "active").length;
  const stocked = open.filter((t) => t.state === "stocked");
  const other = open.length - active - stocked.length;

  const segments: string[] = [];
  if (active > 0) segments.push(`${active} active`);
  if (stocked.length > 0) {
    let nearest: { gap: number; words: string } | null = null;
    for (const t of stocked) {
      const date = t.date;
      if (!date || !isImminent(date, todayISO)) continue;
      const gap = dayGap(date, todayISO);
      const words = trialCountdown(date, todayISO);
      if (gap === null || words === null) continue;
      if (nearest === null || gap < nearest.gap) nearest = { gap, words };
    }
    if (nearest === null) segments.push(`${stocked.length} stocked`);
    else if (stocked.length === 1) segments.push(`1 ${nearest.words}`);
    else segments.push(`${stocked.length} stocked · next ${nearest.words}`);
  }
  if (other > 0) segments.push(`${other} open`);
  return segments.join(" · ");
}

/**
 * The two tiers grave enough to be read at the top of the page. CLOSED where every other
 * vocabulary here is open, and deliberately: escalation is a claim about SEVERITY,
 * and a tier this build has never heard of gives no grounds to make it. So an
 * unknown tier keeps its muted literal in the band and never lights the dot — the
 * unknown-renders-muted doctrine, applied to a mark that can only shout.
 */
const MAJOR_TIERS: readonly string[] = ["heavenly", "grand"];

/**
 * The nearest OPEN major-tier trial inside the imminent window, or null when
 * nothing qualifies — the reading's one escalation. `trialsSummary` above already
 * counts down to the nearest stocked trial in the trials band's own header; this is
 * the step above that, for the two tiers where a week's notice belongs at the TOP of
 * the page rather than four bands down. Open state, not open TIER: an unrecognised
 * state is still live (`splitTrials`) and so still escalates, while an unrecognised
 * tier never does.
 *
 * Nearest by day wins; a tie keeps document order, which is the only ranking two
 * trials on the same day have.
 */
export function imminentMajorTrial(
  open: ApertureTrial[],
  todayISO: string,
): ApertureTrial | null {
  let nearest: { gap: number; trial: ApertureTrial } | null = null;
  for (const t of open) {
    if (!MAJOR_TIERS.includes(t.tier)) continue;
    const date = t.date;
    if (!date || !isImminent(date, todayISO)) continue;
    const gap = dayGap(date, todayISO);
    if (gap === null) continue;
    if (nearest === null || gap < nearest.gap) nearest = { gap, trial: t };
  }
  return nearest === null ? null : nearest.trial;
}

// --- the sea band's reading -------------------------------------------------------

/** What each stage's aperture is sheathed in — the canon's own reading of how far
 *  into a rank one stands. Typed as a TOTAL record over the stage vocabulary, so a
 *  stage without a membrane is a tsc error rather than an `undefined` in the line. */
const STAGE_MEMBRANE: Record<ApertureStage, string> = {
  initial: "light membrane",
  middle: "water membrane",
  upper: "stone membrane",
  peak: "crystal",
};

/**
 * The membrane over a stage, or null for a stage this build has never heard of —
 * including every immortal rank, which is stageless by canon. The sea band omits
 * the phrase entirely rather than naming a sheath nobody assigned — the same
 * bargain every open vocabulary here keeps.
 */
export function membraneOf(stage: string): string | null {
  return isApertureStage(stage) ? STAGE_MEMBRANE[stage] : null;
}

// --- the skin's small glyph vocabulary -------------------------------------------

/** A trial tier's single glyph — 地 earthly, 天 heavenly, 大 grand. Unknown tiers
 *  get none: the literal tier word still prints beside it either way. */
const TIER_GLYPHS: Record<string, string> = {
  earthly: "地",
  heavenly: "天",
  grand: "大",
};

export function tierGlyph(tier: string): string | null {
  return TIER_GLYPHS[tier] ?? null;
}

// --- the mortal pulse row -------------------------------------------------------

/** The three mortal signals the day already has server-side. */
export interface MortalSignals {
  riichiStreak: number;
  tftGames: number;
  /** Chapters read since ~a week ago; null while the index has no baseline yet. */
  readingDelta: number | null;
}

/** One `label value unit` segment of the mortal row. */
export interface MortalSegment {
  label: string;
  value: string;
  unit?: string;
}

/**
 * The mortal row, as segments: `riichi streak 4 · tft +3 · reading +9 ch`. The
 * reading segment DROPS OUT rather than reading zero when there is no baseline to
 * diff against — a "+0" the site made up is worse than a shorter line.
 */
export function mortalSegments(s: MortalSignals): MortalSegment[] {
  const segments: MortalSegment[] = [
    { label: "riichi streak", value: `${s.riichiStreak}` },
    { label: "tft", value: signedCount(s.tftGames) },
  ];
  if (s.readingDelta !== null)
    segments.push({
      label: "reading",
      value: signedCount(s.readingDelta),
      unit: "ch",
    });
  return segments;
}

// --- the harvest ----------------------------------------------------------------

/** A `**bold lead**` at the very head of a paragraph, and nothing anywhere else. */
const LEAD = /^\*\*(.+?)\*\*/;

/**
 * A harvest paragraph split into its bold LEAD and the prose that follows it. The
 * check-in writes its passages with a numbered lead sentence (`**1. The line
 * pattern.** Ability holds…`), and that lead is the only markdown this page reads:
 * everything else — including a `**` later in the same paragraph — prints
 * literally, because the sealed passage is prose the site renders and never
 * interprets.
 *
 * The separator rides in `rest` (`" Ability holds…"`), so a caller can print the
 * two halves back to back and get the sentence it sealed. An unterminated `**`, or
 * one that isn't at the head, is not a lead — those cases return the paragraph
 * whole rather than swallowing text into an emphasis that was never opened.
 */
export function splitLead(paragraph: string): {
  lead: string | null;
  rest: string;
} {
  const m = LEAD.exec(paragraph);
  if (m === null) return { lead: null, rest: paragraph };
  return { lead: m[1], rest: paragraph.slice(m[0].length) };
}

// --- the adjudication rider -----------------------------------------------------

/** A vault daily note's title is its Sydney calendar day, and nothing else is. */
const DAILY_TITLE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The newest daily-note day among a set of vault note titles that has actually
 * HAPPENED, or null when none of them is a day. `today` (the Sydney calendar day)
 * caps the scan: day-planner notes are pre-created for rostered shifts, and a
 * shift next Saturday is a plan, not journal activity the seal could be behind.
 * Lexical comparison is the whole trick — `YYYY-MM-DD` sorts as it counts — and
 * titles that aren't days (every other note in the vault) are simply not days,
 * not errors. Feeds `isAdjudicationPending`: this is the raw journal edge the
 * seal is measured against.
 */
export function latestDailyDay(titles: string[], today: string): string | null {
  let latest: string | null = null;
  for (const title of titles)
    if (
      DAILY_TITLE.test(title) &&
      title <= today &&
      (latest === null || title > latest)
    )
      latest = title;
  return latest;
}

// --- the dao band (ADR 0167) --------------------------------------------------

/** One row of the 道 band: a marks-bearing path in its own unit. */
export interface DaoRow {
  /** The node's name, lowercased into the band's register. */
  name: string;
  count: number;
  unit: string;
  /** The node's OWN declared activity — the live "+n this wk" lookup key; null
   *  when the node declares none (the row then prints without the column). */
  activity: string | null;
}

/**
 * Every marks-bearing node of the paths tree, in reading order (a path before
 * its subs). The check-in decides which nodes carry a ledger — the walk just
 * collects; different rows' counts are different substances and are never
 * summed here or anywhere.
 */
export function daoRows(paths: AperturePath[]): DaoRow[] {
  const out: DaoRow[] = [];
  const walk = (list: AperturePath[]) => {
    for (const p of list) {
      if (p.marks)
        out.push({
          name: p.name.toLowerCase(),
          count: p.marks.count,
          unit: p.marks.unit,
          activity: p.activity ?? null,
        });
      if (p.sub) walk(p.sub);
    }
  };
  walk(paths);
  return out;
}

/** Days in the trailing week that left evidence — nonzero entries among the
 *  last 7 of a daily series. The dao band's live accrual beside the sealed
 *  count (the soul's grade/count split, per row). */
export function evidenceDaysThisWeek(values: number[]): number {
  return values.slice(-7).filter((v) => v > 0).length;
}

/**
 * The soul's raw count: how many DISTINCT journal days the vault holds — one
 * recorded day is one man soul (the soul band's evidence figure). Same discipline
 * as `latestDailyDay`: only exact-day titles are days, and days past `today` are
 * plans (pre-created day-planner notes), not lived days a soul could hold.
 * Distinctness guards a duplicated title ever counting twice.
 */
export function recordedDays(titles: string[], today: string): number {
  const days = new Set<string>();
  for (const title of titles)
    if (DAILY_TITLE.test(title) && title <= today) days.add(title);
  return days.size;
}
