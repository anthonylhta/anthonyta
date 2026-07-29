import {
  isApertureStage,
  type AperturePath,
  type ApertureCondition,
  type ApertureDoc,
  type ApertureGlance,
  type ApertureTrial,
} from "./aperture";

/**
 * apertureview — the pure view spine of the character sheet: the masthead and the
 * sealed island below it. Every decision those components make lives here: which of
 * the six island states to render, which literal Tailwind class a colour or a status
 * wears, how a date turns into a countdown, what a band's right-hand summary says,
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

/** The same canon as fills — the masthead's rank bar and its swatch. */
export const ESSENCE_SWATCH: Record<string, string> = {
  "Jade Green": "bg-jade-green",
  "Pale Green": "bg-pale-green",
  "Dark Green": "bg-dark-green",
  "Black Green": "bg-black-green",
  "Light Red": "bg-light-red",
  Scarlet: "bg-scarlet",
  Crimson: "bg-crimson",
  "Dark Red": "bg-dark-red",
  "Light Silver": "bg-light-silver",
  "Blossom Silver": "bg-blossom-silver",
  "Bright Silver": "bg-bright-silver",
  "Snow Silver": "bg-snow-silver",
  "Light Gold": "bg-light-gold",
  "Bright Gold": "bg-bright-gold",
  "Essence Gold": "bg-essence-gold",
  "True Gold": "bg-true-gold",
  "Light Purple": "bg-light-purple",
  Violet: "bg-violet",
  "Deep Purple": "bg-deep-purple",
  "Crystal Purple": "bg-crystal-purple",
  "Green Grape": "bg-green-grape",
  "Red Date": "bg-red-date",
  "White Litchi": "bg-white-litchi",
  "Yellow Apricot": "bg-yellow-apricot",
};

/** The class every unknown thing wears — one literal, one doctrine. */
const MUTED = "text-muted";

/** A canon name's text class; no canon (or a name this build never heard of)
 *  renders muted rather than picking a colour nobody assigned. */
export function essenceTextClass(name: string | null): string {
  return (name && ESSENCE_TEXT[name]) || MUTED;
}

/** A canon name's swatch class, or null — no canon means NO swatch at all, not a
 *  grey one: an unpainted square would read as a colour the canon never gave. */
export function essenceSwatchClass(name: string | null): string | null {
  return (name && ESSENCE_SWATCH[name]) || null;
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
 * `gym` is the first SEALED series here, and the reason `source` no longer means
 * "connector": its days live in the E2EE gym envelope, so the server that renders
 * the other three cannot produce this one. The island decrypts it and merges it in
 * (GuideSealed) — the entry is still needed here, because being in this map is what
 * makes a path's `activity: "gym"` drawable at all.
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
  }),
);

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

// --- the masthead's rank reading ------------------------------------------------

/** The zero-tap line: "RANK 3 · UPPER". The stage is uppercased whether or not
 *  this build knows it — it's a literal either way, and an unknown stage still
 *  belongs on the masthead. */
export function bandLine(glance: ApertureGlance): string {
  return `RANK ${glance.rank} · ${glance.stage.toUpperCase()}`;
}

/** 一 through 九 — the nine ranks. Index is `rank - 1`; anything off the end is a
 *  rank this canon has no numeral for. */
const RANK_NUMERALS: readonly string[] = [
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
];

/** The four mortal stages, in the canon's own glyphs. */
const STAGE_GLYPHS: Record<string, string> = {
  initial: "初期",
  middle: "中期",
  upper: "后期",
  peak: "巅峰",
};

/**
 * The masthead's quiet flourish: 一转·初期 for rank 1 initial. Muted decoration over
 * the rank line, never the reading itself, so it is allowed to say LESS than the
 * line above it and never more: a rank outside the canon's nine numerals renders
 * nothing at all (rather than a numeral nobody assigned), and a stage this build has
 * never heard of — including every immortal rank, which is stageless by canon —
 * leaves the glyphs at the rank alone.
 */
export function stageGlyphs(rank: number, stage: string): string | null {
  if (!Number.isInteger(rank)) return null;
  const numeral = RANK_NUMERALS[rank - 1];
  if (numeral === undefined) return null;
  const glyph = isApertureStage(stage) ? STAGE_GLYPHS[stage] : undefined;
  return glyph === undefined ? `${numeral}转` : `${numeral}转·${glyph}`;
}

/** 壹 through 玖 — the financial forms, the display register for the masthead's
 *  large numeral (the running-text 一转·初期 above keeps the plain forms). */
const DISPLAY_NUMERALS: readonly string[] = [
  "壹",
  "贰",
  "叁",
  "肆",
  "伍",
  "陆",
  "柒",
  "捌",
  "玖",
];

/** The masthead's large rank glyph, or null off the canon's nine — a rank with
 *  no numeral shows none, exactly like the stage glyphs above. */
export function displayNumeral(rank: number): string | null {
  if (!Number.isInteger(rank)) return null;
  return DISPLAY_NUMERALS[rank - 1] ?? null;
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

/** How many strokes of tally the wall will ink before falling back to digits
 *  alone — three full 正 reads at a glance, more reads as a woodpile. */
const TALLY_MAX = 15;

/**
 * A strike count as Chinese tally marks — 正 per completed five, 丨 per remainder
 * (the count-to-正 convention: five strokes complete the character). Null for
 * zero, non-integers, and anything past the cap — the digit beside it is always
 * printed, so the tally only ever ADDS a reading, never replaces one.
 */
export function tallyMarks(n: number): string | null {
  if (!Number.isInteger(n) || n <= 0 || n > TALLY_MAX) return null;
  return "正".repeat(Math.floor(n / 5)) + "丨".repeat(n % 5);
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

// --- the adjudication rider -----------------------------------------------------

/** A vault daily note's title is its Sydney calendar day, and nothing else is. */
const DAILY_TITLE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The newest daily-note day among a set of vault note titles, or null when none of
 * them is a day. Lexical comparison is the whole trick — `YYYY-MM-DD` sorts as it
 * counts — and titles that aren't days (every other note in the vault) are simply
 * not days, not errors. Feeds `isAdjudicationPending`: this is the raw journal edge
 * the seal is measured against.
 */
export function latestDailyDay(titles: string[]): string | null {
  let latest: string | null = null;
  for (const title of titles)
    if (DAILY_TITLE.test(title) && (latest === null || title > latest))
      latest = title;
  return latest;
}
