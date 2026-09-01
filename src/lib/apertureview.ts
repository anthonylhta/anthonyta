import {
  isApertureStage,
  type AperturePath,
  type ApertureCondition,
  type ApertureDoc,
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
