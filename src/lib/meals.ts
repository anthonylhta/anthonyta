/**
 * meals — the pure spine of the E2EE meal log. The food library, the day's
 * entries and the daily targets all live in ONE sealed envelope at `meta/meals`
 * (the fin pattern's sixth outing), decrypted and edited only in the browser
 * behind the vault unlock. The server moves ciphertext it never parses, so every
 * size/shape cap here is CLIENT-side law — the route can only check the envelope
 * frame.
 *
 * An entry is a food and a QUANTITY, never a set of macros: the numbers are
 * looked up once, when the food joins the library, and every meal after that is
 * a multiplication. That is the whole reason this can be logged daily — the /gym
 * templates insight applied to food.
 *
 * Ordering is structural, not sorted: `addEntry` PREPENDS, so `entries` is
 * newest-first by construction and eviction takes from the TAIL. Nothing ever
 * re-sorts by date — `date` is what the entry says about itself, not a key.
 *
 * Every transform is re-runnable against a fresh base, because that is what the
 * 409 dance does: on a conflict the island refetches, re-applies the SAME pure
 * function, and PUTs again. So each one is idempotent on its own id — applying
 * it twice (or against a base that already has it) changes nothing.
 */

import { isValidSeq } from "./seqrule";

/** Envelope frame cap for the PUT — the same ceiling the gym log gets; a year of
 *  six entries a day plus a full library is a small fraction of it. */
export const MEALS_MAX_BYTES = 262_144;

/** Sealed-envelope overhead over the JSON payload, rounded UP: 4 magic + 12 IV +
 *  16 GCM tag + 4 header-length prefix + the meta header JSON (~50 bytes). The
 *  client budgets against this so the owner sees a refusal with a reason instead
 *  of the route's opaque 404 (which is all a frame check can give). */
export const MEALS_ENVELOPE_OVERHEAD = 128;

export const MAX_FOODS = 200;
/** At ~6 entries a day that is ~100 days — far past the 14-day strip's reach. */
export const MAX_ENTRIES = 600;
const MAX_NAME = 60;
const MAX_ID = 64;
/** One portion, not a shopping trip; and kilocalories, not kilojoules. */
const MAX_QTY = 100;
const MAX_MACRO = 10_000;

/** One library food, with its macros per ONE unit — the unit is whatever the
 *  name says it is ("rice (bowl)", "chicken thigh"). */
export interface MealsFood {
  id: string;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
}

/** One thing eaten: a library food, on a day, some number of units of it. */
export interface MealsEntry {
  id: string;
  /** The Sydney calendar day it was logged on, `YYYY-MM-DD`. */
  date: string;
  foodId: string;
  /** Units of the food — decimal, so half a serve is one tap of the keypad. */
  qty: number;
}

export interface MealsTargets {
  kcal: number;
  p: number;
  c: number;
  f: number;
}

export interface MealsConfig {
  v: 1;
  foods: MealsFood[];
  /** Newest-first by construction (see the module note). */
  entries: MealsEntry[];
  /** Absent until the owner sets them — there is no sensible default daily
   *  intake to invent, so the day renders as totals with nothing to read
   *  against. */
  targets?: MealsTargets;
  /** Sealed write counter (58b rollback detection) — see lib/seqrule. */
  seq?: number;
}

export const EMPTY_MEALS_CONFIG: MealsConfig = { v: 1, foods: [], entries: [] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isId(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= MAX_ID;
}

function isName(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= MAX_NAME;
}

function isMacro(x: unknown): x is number {
  return (
    typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_MACRO
  );
}

function isTargets(x: unknown): x is MealsTargets {
  return (
    isObj(x) && isMacro(x.kcal) && isMacro(x.p) && isMacro(x.c) && isMacro(x.f)
  );
}

function isFood(x: unknown): x is MealsFood {
  return (
    isObj(x) &&
    isId(x.id) &&
    isName(x.name) &&
    isMacro(x.kcal) &&
    isMacro(x.p) &&
    isMacro(x.c) &&
    isMacro(x.f)
  );
}

function isEntry(x: unknown): x is MealsEntry {
  return (
    isObj(x) &&
    isId(x.id) &&
    typeof x.date === "string" &&
    DATE_RE.test(x.date) &&
    isId(x.foodId) &&
    typeof x.qty === "number" &&
    Number.isFinite(x.qty) &&
    x.qty > 0 &&
    x.qty <= MAX_QTY
  );
}

/** Strict parse of a decrypted config — null on anything unrecognizable, so a
 *  tampered payload reads as "cannot decrypt", never as an empty log. */
export function normalizeMealsConfig(x: unknown): MealsConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!Array.isArray(x.foods) || x.foods.length > MAX_FOODS) return null;
  if (!x.foods.every(isFood)) return null;
  if (!Array.isArray(x.entries) || x.entries.length > MAX_ENTRIES) return null;
  if (!x.entries.every(isEntry)) return null;
  if (x.targets !== undefined && !isTargets(x.targets)) return null;
  if (!isValidSeq(x.seq)) return null;
  // Carry `targets` and `seq` through the rebuild — dropping either would erase
  // a field on the next write (the prf-label lesson: a rebuild that forgets a
  // field it didn't know about silently deletes it).
  return {
    v: 1,
    foods: x.foods,
    entries: x.entries,
    ...(x.targets !== undefined ? { targets: x.targets as MealsTargets } : {}),
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
  };
}

/** The config as it will be sealed, in bytes — the figure the /meals readout
 *  shows against the cap, and what `fitsMealsCap` budgets. */
export function mealsPayloadBytes(cfg: MealsConfig): number {
  return new TextEncoder().encode(JSON.stringify(cfg)).length;
}

/** Whether this config still fits the envelope cap once sealed. The client
 *  refuses a save that wouldn't, rather than sending bytes the route will 404. */
export function fitsMealsCap(cfg: MealsConfig): boolean {
  return mealsPayloadBytes(cfg) + MEALS_ENVELOPE_OVERHEAD <= MEALS_MAX_BYTES;
}

// --- transforms ----------------------------------------------------------------

function rebuild(cfg: MealsConfig, patch: Partial<MealsConfig>): MealsConfig {
  const next: MealsConfig = {
    v: 1,
    foods: cfg.foods,
    entries: cfg.entries,
    ...(cfg.targets !== undefined ? { targets: cfg.targets } : {}),
    ...patch,
  };
  if (cfg.seq !== undefined) next.seq = cfg.seq;
  return next;
}

/**
 * Add one food to the library. An id already present is a no-op, so the 409
 * dance can re-run it; an empty name is refused rather than stored blank.
 */
export function addFood(cfg: MealsConfig, food: MealsFood): MealsConfig {
  const name = food.name.trim().slice(0, MAX_NAME);
  if (!name) return cfg;
  if (cfg.foods.length >= MAX_FOODS) return cfg;
  if (cfg.foods.some((f) => f.id === food.id)) return cfg;
  return rebuild(cfg, { foods: [...cfg.foods, { ...food, name }] });
}

/** Edit a food in place — every entry references it by id, so the whole history
 *  follows the correction with nothing to migrate. */
export function updateFood(
  cfg: MealsConfig,
  id: string,
  patch: Partial<Omit<MealsFood, "id">>,
): MealsConfig {
  if (!cfg.foods.some((f) => f.id === id)) return cfg;
  const name =
    patch.name === undefined ? undefined : patch.name.trim().slice(0, MAX_NAME);
  if (name === "") return cfg;
  return rebuild(cfg, {
    foods: cfg.foods.map((f) =>
      f.id === id ? { ...f, ...patch, name: name ?? f.name } : f,
    ),
  });
}

/**
 * Remove a food from the library — but only while nothing has been eaten of it.
 * A referenced food is a no-op: deleting it would silently rewrite the totals of
 * every past day that contained it, which is history the log has no right to
 * change. Rename it instead. An unknown id is a no-op too, so the 409 dance can
 * re-run this against a base another device already pruned.
 */
export function removeFood(cfg: MealsConfig, id: string): MealsConfig {
  if (!cfg.foods.some((f) => f.id === id)) return cfg;
  if (cfg.entries.some((e) => e.foodId === id)) return cfg;
  return rebuild(cfg, { foods: cfg.foods.filter((f) => f.id !== id) });
}

/**
 * Prepend one eaten thing (newest first). Past the cap the OLDEST entry (the
 * tail) is evicted: the trailing strip looks back a fortnight, so a log losing
 * its hundredth day back is the honest trade for a fixed envelope.
 *
 * Idempotent on `id`, so the 409 dance can re-run it against a fresh base that
 * may already contain it.
 */
export function addEntry(cfg: MealsConfig, entry: MealsEntry): MealsConfig {
  if (cfg.entries.some((e) => e.id === entry.id)) return cfg;
  return rebuild(cfg, {
    entries: [entry, ...cfg.entries].slice(0, MAX_ENTRIES),
  });
}

/** Remove one entry by id. An unknown id is a no-op (re-runnable). */
export function removeEntry(cfg: MealsConfig, id: string): MealsConfig {
  if (!cfg.entries.some((e) => e.id === id)) return cfg;
  return rebuild(cfg, { entries: cfg.entries.filter((e) => e.id !== id) });
}

/**
 * Set the daily targets the bars read against — or clear them: all zeros means
 * "no target", not a target of nothing. That is also what the pristine form
 * parses to, so a stray save can't wedge every reading into permanently-over,
 * and zeroing the fields is the way back to totals-only. Re-running the same
 * set changes nothing further — the replacement is the same value.
 */
export function setTargets(
  cfg: MealsConfig,
  targets: MealsTargets,
): MealsConfig {
  if (
    targets.kcal === 0 &&
    targets.p === 0 &&
    targets.c === 0 &&
    targets.f === 0
  ) {
    const next = rebuild(cfg, {});
    delete next.targets;
    return next;
  }
  return rebuild(cfg, { targets });
}

// --- derived readings ----------------------------------------------------------

/** A food's display name, or "?" when the id names nothing this config carries
 *  — the UI prints the honest miss rather than a blank. */
export function foodName(cfg: MealsConfig, id: string): string {
  return cfg.foods.find((f) => f.id === id)?.name ?? "?";
}

/** Everything eaten on one day, in the log's own (newest-first) order. */
export function entriesFor(cfg: MealsConfig, date: string): MealsEntry[] {
  return cfg.entries.filter((e) => e.date === date);
}

/**
 * A day's macros: each entry's food, multiplied by its quantity. An entry whose
 * food has left the library contributes NOTHING rather than guessing — but
 * `removeFood` refuses while entries reference it, so this only happens to a
 * payload that was edited elsewhere.
 */
export function dayTotals(cfg: MealsConfig, date: string): MealsTargets {
  const totals: MealsTargets = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const e of entriesFor(cfg, date)) {
    const food = cfg.foods.find((f) => f.id === e.foodId);
    if (!food) continue;
    totals.kcal += food.kcal * e.qty;
    totals.p += food.p * e.qty;
    totals.c += food.c * e.qty;
    totals.f += food.f * e.qty;
  }
  return totals;
}

/** The calendar day before `ymd` (UTC-midnight math, DST-safe) — the activity.ts
 *  helper, needed here because meal days are stored as days, not timestamps. */
export function prevDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The calendar day after `ymd` — `prevDay`'s mirror, for walking the log
 *  forward again. */
export function nextDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const HEADING_WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HEADING_MONTHS = [
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

/** `2026-08-03` → `mon 3 aug` — the day-browser heading. Hand-rolled like
 *  transit's day labels (no locale machinery), and pure UTC math like the
 *  walkers above, so the label can never sit a day off the key it names. */
export function dayHeading(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  return `${HEADING_WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${
    HEADING_MONTHS[date.getUTCMonth()]
  }`;
}

/**
 * Protein per day over the trailing `n` days ending at `endDate`, oldest →
 * newest — the strip under the day's bars.
 *
 * Walks day STRINGS, deliberately: an entry's `date` is already the Sydney
 * calendar day the device wrote it on, so re-bucketing it through a timezone
 * could only move it off the day it says it is (`gym.sessionCounts` and
 * `steps.trailingSeries` take the same approach — a date-keyed store needs no
 * clock).
 */
export function trailingProtein(
  cfg: MealsConfig,
  endDate: string,
  n = 14,
): number[] {
  const out: number[] = [];
  let cursor = endDate;
  for (let i = 0; i < n; i++) {
    out.push(dayTotals(cfg, cursor).p);
    cursor = prevDay(cursor);
  }
  return out.reverse();
}

// --- input parsing -------------------------------------------------------------

/**
 * Interpret a quantity field: `null` rejects it (not a plain positive number —
 * letters, signs, exponents, a second dot, zero, or past the cap), otherwise the
 * number to log. An empty field is `null` too, which is what greys the add
 * button until real digits land.
 *
 * A text field rather than `type="number"`, on purpose: a controlled number
 * input snaps a cleared field straight back to 0, so typing lands beside the
 * prefill (`parseSetInput` carries the same scar).
 */
export function parseQtyInput(text: string): number | null {
  if (!/^\d*\.?\d*$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_QTY) return null;
  return n;
}

/**
 * Interpret a macro/kcal field: whole non-negative numbers only (a gram of
 * precision food labels don't have), `null` on anything else or past the cap.
 * An empty or mid-retype field is 0 — a food with no carbs is left blank, not
 * typed as a zero.
 */
export function parseMacroInput(text: string): number | null {
  if (!/^\d*$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n > MAX_MACRO) return null;
  return n;
}
