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
 * A day stops being a list once it is old enough. Past `FOLD_AFTER_DAYS` the
 * entries of a day are replaced by the four figures they came to, in
 * `dayTotals` — a tenth the bytes, and everything any surface still asks of a
 * day that old. So `entries` is a WINDOW of the recent weeks and `dayTotals` is
 * the tail behind it, which is what lets one fixed envelope hold years instead
 * of dropping the oldest day off the end once the log gets long.
 *
 * The WEIGHTS are the exception, and the only collection here kept sorted: one
 * weigh-in per day, oldest → newest, because every reading of them is a trailing
 * WINDOW and a cap that evicts the oldest is then just a slice off the front.
 *
 * The LIBRARY is the other way round: it is stored in the order foods were typed
 * in and never pruned, so every surface reads it through `rankFoods` (last eaten,
 * then most eaten) off counters `addEntry` keeps on the food itself. Counting on
 * the food rather than scanning the entries is what survives the rolling window —
 * a food's history outlives the entries that made it.
 *
 * Every transform is re-runnable against a fresh base, because that is what the
 * 409 dance does: on a conflict the island refetches, re-applies the SAME pure
 * function, and PUTs again. So each one is idempotent on its own id — applying
 * it twice (or against a base that already has it) changes nothing.
 */

import { tone } from "./money";
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
/** The itemized window's safety cap. The fold reaches a day first (60 days at
 *  ~6 entries a day is ~370 rows), so this should never bind — it is the
 *  backstop under a day that was logged item by item all afternoon. */
export const MAX_ENTRIES = 600;
/** Days past which a day stops being a list and becomes four figures. Every
 *  window here is a fortnight or a week, so 60 days is weeks of slack behind the
 *  furthest any surface looks — and far enough back that nothing still being
 *  corrected gets folded out from under the correction. */
export const FOLD_AFTER_DAYS = 60;
/** Folded days kept, oldest evicted past it — the final backstop, not the
 *  working limit. A row is ~75 bytes, so 2,000 of them (~5½ years) is ~150KB;
 *  with a full library, a full itemized window and a full weight log behind them
 *  the payload still lands inside `MEALS_MAX_BYTES`. That headroom is the point:
 *  a log that outgrew the envelope would refuse every save, including the ones
 *  that would shrink it. */
export const MAX_DAY_TOTALS = 2000;
/** ~13 months of daily weigh-ins; past it the OLDEST morning drops off. At ~30
 *  bytes a row the whole log is ~12KB — the weight of a fortnight of entries,
 *  and the strip never looks further back than ten weeks. */
export const MAX_WEIGHTS = 400;
const MAX_NAME = 60;
const MAX_ID = 64;
/** One portion, not a shopping trip; and kilocalories, not kilojoules. */
const MAX_QTY = 100;
const MAX_MACRO = 10_000;
/** A FOLDED day's ceiling — every cap above it multiplied out. Deliberately far
 *  past anything a person eats: a sum the fold can produce must never be a sum
 *  the reader rejects, or the log would seal itself shut. */
const MAX_DAY_MACRO = MAX_ENTRIES * MAX_MACRO * MAX_QTY;
/** A person, not a barbell — outside these a figure is a typo, not a weigh-in. */
const MIN_KG = 20;
const MAX_KG = 300;
/** Ceiling on the all-time use counter — far past reach at a handful of meals a
 *  day, but a number that rides in the envelope gets a bound like every other. */
const MAX_USES = 1_000_000;

/** One library food, with its macros per ONE unit — the unit is whatever the
 *  name says it is ("rice (bowl)", "chicken thigh"). */
export interface MealsFood {
  id: string;
  name: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  /** Times logged, all-time, and the last day it was eaten — what the library is
   *  ordered and filtered by. `addEntry` keeps them, so they outlive the rolling
   *  entry window. ABSENT on a food that predates the counters and on one never
   *  logged since; `foodUsage` is what derives around that. */
  uses?: number;
  lastUsed?: string;
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

/** One morning's weigh-in. Daily by design and read weekly by design: the number
 *  moves a kilo on water alone, so the day it was taken matters only as the key
 *  the averages window over. */
export interface MealsWeight {
  /** The Sydney calendar day it was measured on, `YYYY-MM-DD`. */
  date: string;
  kg: number;
}

export interface MealsTargets {
  kcal: number;
  p: number;
  c: number;
  f: number;
}

/** One folded day — what it came to, and how much was in it. The list is gone
 *  by design; the count is what keeps the day honest about the fact that it was
 *  five things and not one. */
export interface MealsDayTotal extends MealsTargets {
  /** The Sydney calendar day it covers, `YYYY-MM-DD`. */
  date: string;
  /** How many entries folded into it. */
  entries: number;
}

export interface MealsConfig {
  v: 2;
  foods: MealsFood[];
  /** Newest-first by construction (see the module note). */
  entries: MealsEntry[];
  /** The days behind the fold horizon, oldest → newest, one row per date.
   *  Always present on a v2 config and empty until the first fold — "nothing has
   *  aged out yet" and "nothing ever will" are not two states worth telling
   *  apart. */
  dayTotals: MealsDayTotal[];
  /** Absent until the owner sets them — there is no sensible default daily
   *  intake to invent, so the day renders as totals with nothing to read
   *  against. */
  targets?: MealsTargets;
  /** The weigh-ins, oldest → newest, at most one per date. Absent until the
   *  first morning is logged — a log with no weights has nothing to say about a
   *  body, which is not the same as a body that never changed. */
  weights?: MealsWeight[];
  /** Sealed write counter (58b rollback detection) — see lib/seqrule. */
  seq?: number;
}

export const EMPTY_MEALS_CONFIG: MealsConfig = {
  v: 2,
  foods: [],
  entries: [],
  dayTotals: [],
};

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

function isUses(x: unknown): x is number {
  return (
    typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= MAX_USES
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
    isMacro(x.f) &&
    // The counters are optional, never lax: a food carrying a broken one reads as
    // a tampered payload like any other bad field, rather than as a fresh food.
    (x.uses === undefined || isUses(x.uses)) &&
    (x.lastUsed === undefined ||
      (typeof x.lastUsed === "string" && DATE_RE.test(x.lastUsed)))
  );
}

/** A weight in kilos, to at most one decimal — the precision a bathroom scale
 *  actually has, and the one the field rounds to before it is ever stored. */
function isKg(x: unknown): x is number {
  return (
    typeof x === "number" &&
    Number.isFinite(x) &&
    x >= MIN_KG &&
    x <= MAX_KG &&
    Math.round(x * 10) / 10 === x
  );
}

function isWeight(x: unknown): x is MealsWeight {
  return (
    isObj(x) && typeof x.date === "string" && DATE_RE.test(x.date) && isKg(x.kg)
  );
}

/** A folded day's own figures, on the folded day's own (far looser) ceiling. */
function isDayMacro(x: unknown): x is number {
  return (
    typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_DAY_MACRO
  );
}

function isDayTotal(x: unknown): x is MealsDayTotal {
  return (
    isObj(x) &&
    typeof x.date === "string" &&
    DATE_RE.test(x.date) &&
    isDayMacro(x.kcal) &&
    isDayMacro(x.p) &&
    isDayMacro(x.c) &&
    isDayMacro(x.f) &&
    // The count is a counter like the library's, and gets a counter's bound.
    isUses(x.entries)
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

/**
 * Strict parse of a decrypted config — null on anything unrecognizable, so a
 * tampered payload reads as "cannot decrypt", never as an empty log.
 *
 * A v1 envelope is the shape from before the fold: every day it holds is still
 * itemized, so it simply arrives with nothing folded. Writes always produce v2,
 * and a build that predates the fold reads one as unrecognizable — which is the
 * point of the bump: it refuses the log loudly rather than rewriting it without
 * the folded days it doesn't know are there.
 */
export function normalizeMealsConfig(x: unknown): MealsConfig | null {
  if (!isObj(x) || (x.v !== 1 && x.v !== 2)) return null;
  if (!Array.isArray(x.foods) || x.foods.length > MAX_FOODS) return null;
  if (!x.foods.every(isFood)) return null;
  if (!Array.isArray(x.entries) || x.entries.length > MAX_ENTRIES) return null;
  if (!x.entries.every(isEntry)) return null;
  if (x.targets !== undefined && !isTargets(x.targets)) return null;
  let folded: MealsDayTotal[] = [];
  if (x.v === 2) {
    if (!Array.isArray(x.dayTotals) || x.dayTotals.length > MAX_DAY_TOTALS)
      return null;
    if (!x.dayTotals.every(isDayTotal)) return null;
    // A date twice is two answers for one day — the ambiguity the weigh-ins
    // refuse, and the one the fold's merge exists to prevent.
    const days = new Set(x.dayTotals.map((d: MealsDayTotal) => d.date));
    if (days.size !== x.dayTotals.length) return null;
    folded = x.dayTotals as MealsDayTotal[];
  } else if (x.dayTotals !== undefined) {
    // Folded days under a v1 label: a shape nothing here ever wrote, and one
    // that would lose them if it were read as the pre-fold vintage.
    return null;
  }
  if (x.weights !== undefined) {
    if (!Array.isArray(x.weights) || x.weights.length > MAX_WEIGHTS)
      return null;
    if (!x.weights.every(isWeight)) return null;
    // A date twice is two answers to one morning — an ambiguity every window
    // here would silently average, so it reads as a tampered payload instead.
    const days = new Set(x.weights.map((w: MealsWeight) => w.date));
    if (days.size !== x.weights.length) return null;
  }
  if (!isValidSeq(x.seq)) return null;
  // Carry `targets`, `weights` and `seq` through the rebuild — dropping any of
  // them would erase a field on the next write (the prf-label lesson: a rebuild
  // that forgets a field it didn't know about silently deletes it).
  return {
    v: 2,
    foods: x.foods,
    entries: x.entries,
    dayTotals: folded,
    ...(x.targets !== undefined ? { targets: x.targets as MealsTargets } : {}),
    ...(x.weights !== undefined ? { weights: x.weights as MealsWeight[] } : {}),
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

// --- usage counters ------------------------------------------------------------

/**
 * How often a food has been eaten and when it last was — the ONE reader of the
 * counters, so the derive-on-absent rule lives in exactly one place.
 *
 * A food carrying `uses` answers from the counter: an all-time figure, kept past
 * the fold and the rolling entry window both. A food without one is answered
 * from the entries still in view — an honest reading over the itemized window
 * for a library that predates the counters, replaced by the real one the first
 * time it is logged again.
 */
export function foodUsage(
  cfg: MealsConfig,
  food: MealsFood,
): { uses: number; lastUsed: string | null } {
  if (food.uses !== undefined)
    return { uses: food.uses, lastUsed: food.lastUsed ?? null };
  let uses = 0;
  for (const e of cfg.entries) if (e.foodId === food.id) uses += 1;
  return { uses, lastUsed: lastEatenIn(cfg.entries, food.id) };
}

/** The newest day a food appears on in these entries, or null — string compare,
 *  because `YYYY-MM-DD` sorts as a date already. */
function lastEatenIn(entries: MealsEntry[], foodId: string): string | null {
  let last: string | null = null;
  for (const e of entries)
    if (e.foodId === foodId && (last === null || e.date > last)) last = e.date;
  return last;
}

/** The library with this entry's food counted once more. The first bump reads
 *  `foodUsage`, so a food from before the counters materialises with the window's
 *  count rather than restarting at one; `lastUsed` only ever moves FORWARD, so
 *  back-filling a forgotten dinner onto a past day can't age the food. */
function bumpUsage(cfg: MealsConfig, entry: MealsEntry): MealsFood[] {
  const food = cfg.foods.find((f) => f.id === entry.foodId);
  if (!food) return cfg.foods;
  const { uses, lastUsed } = foodUsage(cfg, food);
  const bumped: MealsFood = {
    ...food,
    uses: Math.min(MAX_USES, uses + 1),
    lastUsed:
      lastUsed !== null && lastUsed > entry.date ? lastUsed : entry.date,
  };
  return cfg.foods.map((f) => (f.id === food.id ? bumped : f));
}

/** The library with a removed entry uncounted. A food with no counters needs
 *  nothing — its derivation already reads the entries the removal left behind. */
function unbumpUsage(
  cfg: MealsConfig,
  gone: MealsEntry,
  remaining: MealsEntry[],
): MealsFood[] {
  const food = cfg.foods.find((f) => f.id === gone.foodId);
  if (!food || food.uses === undefined) return cfg.foods;
  const uses = Math.max(0, food.uses - 1);
  const next: MealsFood = { ...food, uses };
  if (uses === 0) {
    // Back to never-logged: a food with no uses has no last day either.
    delete next.lastUsed;
  } else if (food.lastUsed === gone.date) {
    // The removal invalidated the date, and the window is all there is left to
    // ask — an older use that has since been evicted is unrecoverable.
    const last = lastEatenIn(remaining, food.id);
    if (last === null) delete next.lastUsed;
    else next.lastUsed = last;
  }
  return cfg.foods.map((f) => (f.id === food.id ? next : f));
}

// --- transforms ----------------------------------------------------------------

function rebuild(cfg: MealsConfig, patch: Partial<MealsConfig>): MealsConfig {
  const next: MealsConfig = {
    v: 2,
    foods: cfg.foods,
    entries: cfg.entries,
    dayTotals: cfg.dayTotals,
    ...(cfg.targets !== undefined ? { targets: cfg.targets } : {}),
    ...(cfg.weights !== undefined ? { weights: cfg.weights } : {}),
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
 *
 * A food eaten only on days that have since FOLDED is deletable again, and
 * safely: those days are figures now, not references, so nothing rewrites.
 */
export function removeFood(cfg: MealsConfig, id: string): MealsConfig {
  if (!cfg.foods.some((f) => f.id === id)) return cfg;
  if (cfg.entries.some((e) => e.foodId === id)) return cfg;
  return rebuild(cfg, { foods: cfg.foods.filter((f) => f.id !== id) });
}

/**
 * Prepend one eaten thing (newest first). Past the cap the OLDEST entry (the
 * tail) is evicted — a backstop the fold now reaches first, so an old day loses
 * its itemization to `foldOldDays` rather than losing itself off the tail.
 *
 * Also counts the food (see `bumpUsage`). Idempotent on `id`, so the 409 dance
 * can re-run it against a fresh base that may already contain it — and the same
 * id landing twice must not count twice, which is exactly what that guard buys.
 */
export function addEntry(cfg: MealsConfig, entry: MealsEntry): MealsConfig {
  if (cfg.entries.some((e) => e.id === entry.id)) return cfg;
  return rebuild(cfg, {
    foods: bumpUsage(cfg, entry),
    entries: [entry, ...cfg.entries].slice(0, MAX_ENTRIES),
  });
}

/** Remove one entry by id, uncounting its food. An unknown id is a no-op
 *  (re-runnable) — including for an entry that has since folded away, which is
 *  why the page stops offering the × once a day is a total. */
export function removeEntry(cfg: MealsConfig, id: string): MealsConfig {
  const gone = cfg.entries.find((e) => e.id === id);
  if (!gone) return cfg;
  const entries = cfg.entries.filter((e) => e.id !== id);
  return rebuild(cfg, { foods: unbumpUsage(cfg, gone, entries), entries });
}

/**
 * Fold every day past the horizon into its totals — how the log grows old.
 * Inside `FOLD_AFTER_DAYS` a day is a list of things eaten; past it, it is four
 * figures and a count, which is all any surface still asks of a day that far
 * back (the bars, the strips and the averages all read `dayTotals`, and they
 * read a folded day exactly the same way). The itemized window stays weeks long
 * and the envelope holds years.
 *
 * The figures are the ones the day showed: summed in the log's own order, so the
 * arithmetic is the one `dayTotals` did, then kept to one decimal — the module's
 * standing rule against float dust (`parseMacroInput`), and a tenth below
 * anything a reading prints.
 *
 * A day folded twice MERGES rather than opening a second row for the same date:
 * a forgotten dinner back-filled onto an old day adds to its total. That, and
 * the no-op when nothing is past the horizon, are what make this safe to run on
 * every save and to re-run inside the 409 dance.
 *
 * `today` comes from the device, like every other date here — a clock running
 * ahead folds early, and nothing un-folds.
 */
export function foldOldDays(cfg: MealsConfig, today: string): MealsConfig {
  const cutoff = backDays(today, FOLD_AFTER_DAYS);
  if (!cfg.entries.some((e) => e.date < cutoff)) return cfg;

  // Sum first, round once: rounding each addition would drift the total off the
  // figure the day actually showed.
  const kept: MealsEntry[] = [];
  const sums = new Map<string, { totals: MealsTargets; entries: number }>();
  for (const e of cfg.entries) {
    if (e.date >= cutoff) {
      kept.push(e);
      continue;
    }
    const acc = sums.get(e.date) ?? {
      totals: { kcal: 0, p: 0, c: 0, f: 0 },
      entries: 0,
    };
    const macros = entryMacros(cfg, e);
    acc.totals.kcal += macros.kcal;
    acc.totals.p += macros.p;
    acc.totals.c += macros.c;
    acc.totals.f += macros.f;
    acc.entries += 1;
    sums.set(e.date, acc);
  }

  const rows = new Map(cfg.dayTotals.map((d) => [d.date, d]));
  for (const [date, acc] of sums) {
    const prior = rows.get(date);
    rows.set(date, {
      date,
      kcal: oneDecimal((prior?.kcal ?? 0) + acc.totals.kcal),
      p: oneDecimal((prior?.p ?? 0) + acc.totals.p),
      c: oneDecimal((prior?.c ?? 0) + acc.totals.c),
      f: oneDecimal((prior?.f ?? 0) + acc.totals.f),
      entries: Math.min(MAX_USES, (prior?.entries ?? 0) + acc.entries),
    });
  }

  return rebuild(cfg, {
    entries: kept,
    // Oldest → newest like the weigh-ins, so the cap takes from the front: past
    // it the oldest day goes, which is the one thing left to lose.
    dayTotals: [...rows.values()]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-MAX_DAY_TOTALS),
  });
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

/** Everything eaten on one day, in the log's own (newest-first) order — EMPTY
 *  for a folded day, whose list is gone by design. Ask `foldedDay` before
 *  reading an empty answer as "nothing was eaten". */
export function entriesFor(cfg: MealsConfig, date: string): MealsEntry[] {
  return cfg.entries.filter((e) => e.date === date);
}

/** The folded record for a day, or null while the day is still itemized (or was
 *  never written at all) — the question every surface asks before it reaches for
 *  the entries. */
export function foldedDay(
  cfg: MealsConfig,
  date: string,
): MealsDayTotal | null {
  return cfg.dayTotals.find((d) => d.date === date) ?? null;
}

/** Whether anything was written against a day — entries, or a folded total. What
 *  separates a day that went unlogged from one whose list has aged out: the
 *  windows here average the days that were written, and a folded day was. */
export function dayIsLogged(cfg: MealsConfig, date: string): boolean {
  return entriesFor(cfg, date).length > 0 || foldedDay(cfg, date) !== null;
}

/** One entry's macros — the food's per-unit figures times the quantity, and the
 *  only place that multiplication lives. An entry whose food has left the
 *  library contributes NOTHING rather than guessing (see `dayTotals`). */
function entryMacros(cfg: MealsConfig, entry: MealsEntry): MealsTargets {
  const food = cfg.foods.find((f) => f.id === entry.foodId);
  if (!food) return { kcal: 0, p: 0, c: 0, f: 0 };
  return {
    kcal: food.kcal * entry.qty,
    p: food.p * entry.qty,
    c: food.c * entry.qty,
    f: food.f * entry.qty,
  };
}

/**
 * A day's macros: each entry's food, multiplied by its quantity. An entry whose
 * food has left the library contributes NOTHING rather than guessing — but
 * `removeFood` refuses while entries reference it, so this only happens to a
 * payload that was edited elsewhere.
 *
 * A FOLDED day answers from its own record instead: the entries that made it are
 * gone, and these are the figures they came to. Every reading here goes through
 * this function, which is what makes the fold invisible to all of them.
 */
export function dayTotals(cfg: MealsConfig, date: string): MealsTargets {
  const folded = foldedDay(cfg, date);
  if (folded)
    return { kcal: folded.kcal, p: folded.p, c: folded.c, f: folded.f };
  const totals: MealsTargets = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const e of entriesFor(cfg, date)) {
    const macros = entryMacros(cfg, e);
    totals.kcal += macros.kcal;
    totals.p += macros.p;
    totals.c += macros.c;
    totals.f += macros.f;
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

/** Whole calendar days from one day-string to the other, in the walkers' own
 *  UTC-midnight math (so a DST weekend can't round one off). Negative when `to`
 *  precedes `from` — the callers here only ever look backwards. */
export function daysSinceYmd(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** `today` · `3d` · nothing — how a food's last use reads beside its name. Never
 *  logged says nothing at all rather than inventing a zero. */
export function ageLabel(lastUsed: string | null, today: string): string {
  if (lastUsed === null) return "";
  const days = daysSinceYmd(lastUsed, today);
  return days === 0 ? "today" : `${days}d`;
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

/**
 * The average day over the trailing `days` ending at `day`, inclusive — the
 * reading the day's own bars cannot give, because one big dinner or one skipped
 * lunch says nothing on its own.
 *
 * Only days with SOMETHING logged are averaged, and `logged` says how many that
 * was: a day with no entries is a day that went unwritten, not a day of fasting,
 * and counting it as a zero would drag the average down toward meals that were
 * eaten and never typed. A folded day counts as written (`dayIsLogged`) — its
 * list is gone, its totals are not. Null when the whole window is unwritten —
 * there is no average of no days to state, and a first week should say nothing
 * rather than something wrong.
 *
 * Plain means, unrounded: how many figures a reading shows is the surface's
 * call, not this one's.
 */
export function trailingAverage(
  cfg: MealsConfig,
  day: string,
  days: number,
): { logged: number; avg: MealsTargets } | null {
  const sum: MealsTargets = { kcal: 0, p: 0, c: 0, f: 0 };
  let logged = 0;
  let cursor = day;
  for (let i = 0; i < days; i++) {
    if (dayIsLogged(cfg, cursor)) {
      const totals = dayTotals(cfg, cursor);
      sum.kcal += totals.kcal;
      sum.p += totals.p;
      sum.c += totals.c;
      sum.f += totals.f;
      logged += 1;
    }
    cursor = prevDay(cursor);
  }
  if (logged === 0) return null;
  return {
    logged,
    avg: {
      kcal: sum.kcal / logged,
      p: sum.p / logged,
      c: sum.c / logged,
      f: sum.f / logged,
    },
  };
}

// --- bodyweight ----------------------------------------------------------------

/**
 * Log (or correct) one morning's weight. Upsert by DATE — a second weigh-in on
 * the same day replaces the first rather than joining it, because a day has one
 * weight and two would be an average nobody asked for. The list comes back
 * sorted, and past the cap the oldest morning is the one that goes.
 *
 * Out-of-range or unparseable figures are a NO-OP, not a stored zero: the field
 * simply doesn't stick. Re-runnable on the same day+kilos, so the 409 dance can
 * apply it twice.
 */
export function setWeight(
  cfg: MealsConfig,
  date: string,
  kg: number,
): MealsConfig {
  if (!DATE_RE.test(date)) return cfg;
  const rounded = Math.round(kg * 10) / 10;
  if (!isKg(rounded)) return cfg;
  const weights = [
    ...(cfg.weights ?? []).filter((w) => w.date !== date),
    { date, kg: rounded },
  ]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-MAX_WEIGHTS);
  return rebuild(cfg, { weights });
}

/** Unlog a day — for the morning the scale was read wrong, or the field was
 *  cleared. A day with no weigh-in is a no-op (re-runnable); an emptied list
 *  stays an empty list rather than vanishing, which is the honest shape for a
 *  log that has weighed and stopped. */
export function clearWeight(cfg: MealsConfig, date: string): MealsConfig {
  if (!cfg.weights?.some((w) => w.date === date)) return cfg;
  return rebuild(cfg, {
    weights: cfg.weights.filter((w) => w.date !== date),
  });
}

/** What the scale said on one day, or null — the figure the field shows for the
 *  day being viewed. */
export function weightFor(cfg: MealsConfig, date: string): number | null {
  return cfg.weights?.find((w) => w.date === date)?.kg ?? null;
}

/** One decimal — the precision every reading here prints and stores at. */
function oneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

/** `ymd` shifted back `n` whole days, walked through `prevDay` so the windows
 *  below run on the same UTC-midnight arithmetic as every other walker here. */
function backDays(ymd: string, n: number): string {
  let cursor = ymd;
  for (let i = 0; i < n; i++) cursor = prevDay(cursor);
  return cursor;
}

/** The weigh-ins in the 7 days ending at `day`, inclusive — summed and counted,
 *  unrounded. Days without one contribute NOTHING (a morning not weighed is not
 *  a morning at zero), which is what makes `logged` the honest denominator. */
function weightWindow(
  cfg: MealsConfig,
  day: string,
  days = 7,
): { sum: number; logged: number } {
  let sum = 0;
  let logged = 0;
  let cursor = day;
  for (let i = 0; i < days; i++) {
    const kg = weightFor(cfg, cursor);
    if (kg !== null) {
      sum += kg;
      logged += 1;
    }
    cursor = prevDay(cursor);
  }
  return { sum, logged };
}

/**
 * The reading the daily number cannot give: this week's average weight, and how
 * far it moved from the week before.
 *
 * Water, salt and the hour of the morning swing the scale a kilo either way, so
 * the average is the signal and the morning is noise — and the drift is only
 * stated when BOTH weeks carry at least two weigh-ins. One point per week is
 * two mornings compared, not a trend, and printing it as one would invite the
 * exact over-reading this whole reading exists to prevent. Null averages and
 * null drifts stay null: nothing is invented from an unweighed week.
 */
export function weightTrend(
  cfg: MealsConfig,
  day: string,
): { avg: number | null; logged: number; deltaPerWeek: number | null } {
  const now = weightWindow(cfg, day);
  if (now.logged === 0) return { avg: null, logged: 0, deltaPerWeek: null };
  const mean = now.sum / now.logged;
  const prior = weightWindow(cfg, backDays(day, 7));
  const enough = now.logged >= 2 && prior.logged >= 2;
  return {
    avg: oneDecimal(mean),
    logged: now.logged,
    deltaPerWeek: enough ? oneDecimal(mean - prior.sum / prior.logged) : null,
  };
}

/**
 * Weekly averages, oldest → newest — the strip on the vessel band. Each value is
 * one 7-day window, stepping back a week at a time from `day`.
 *
 * A week with no weigh-in contributes NOTHING rather than a zero: padding the
 * gap would draw a cliff to the floor and back, which is a picture of a holiday,
 * not of a body (the record band's rule). So the series can be shorter than
 * `weeks`, and a caller wanting a trend gates on its length.
 */
export function weeklyWeightAverages(
  cfg: MealsConfig,
  day: string,
  weeks = 10,
): number[] {
  const out: number[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const { sum, logged } = weightWindow(cfg, backDays(day, 7 * k));
    if (logged > 0) out.push(oneDecimal(sum / logged));
  }
  return out;
}

/**
 * A week-over-week drift as both surfaces print it: the signed figure to one
 * decimal, and the colour its sign has earned. Shared so the /meals row and the
 * vessel band cannot end up disagreeing about which way is green.
 *
 * A real minus sign, not a hyphen (these are typeset figures, not ASCII), and a
 * flat week reads `0.0` with no sign at all — there is no direction to claim.
 */
export function driftLabel(delta: number): { text: string; tone: string } {
  const abs = Math.abs(delta).toFixed(1);
  return {
    text: delta > 0 ? `+${abs}` : delta < 0 ? `−${abs}` : "0.0",
    tone: tone(delta),
  };
}

// --- energy balance ------------------------------------------------------------

/** What a kilogram of body mass is worth in kilocalories — the textbook figure
 *  every energy-balance estimate is built on. Approximate by nature: it is fat's
 *  number, and a week's drift is never only fat. */
const KCAL_PER_KG = 7700;

/** Days of the trailing week that must actually be written before an intake
 *  average is allowed to become a claim about the whole week. Under this, the
 *  mean is of the days that were remembered, which skews toward the days worth
 *  remembering. A folded day is a written one — the gate counts what was logged,
 *  not what is still itemized (and the window is a week, so it never reaches the
 *  fold horizon anyway). */
const ENERGY_MIN_LOGGED_DAYS = 4;

/**
 * What the week was worth: the daily energy balance the scale implies, and the
 * intake it implies the body burns. The one reading neither log can give alone —
 * the meals say what went in and the weight says what came of it.
 *
 * Both figures are estimates and are rounded to the nearest ten so they read as
 * estimates. The surplus is the week's drift priced at `KCAL_PER_KG` and spread
 * over seven days; the burn is simply what the intake had left over.
 *
 * Null unless BOTH halves are trustworthy, which is most of what this function
 * is. The drift comes on `weightTrend`'s terms (two weigh-ins in each of the two
 * weeks, or nothing) and the intake needs a week that was mostly written down;
 * either missing and there is no line, because an energy balance off a half-kept
 * log is a confident number about nothing.
 */
export function energyBalance(
  cfg: MealsConfig,
  day: string,
): { surplus: number; tdee: number } | null {
  const fed = trailingAverage(cfg, day, 7);
  if (!fed || fed.logged < ENERGY_MIN_LOGGED_DAYS) return null;
  const { deltaPerWeek } = weightTrend(cfg, day);
  if (deltaPerWeek === null) return null;
  const surplus = (deltaPerWeek * KCAL_PER_KG) / 7;
  return {
    surplus: nearestTen(surplus),
    tdee: nearestTen(fed.avg.kcal - surplus),
  };
}

/** To the nearest ten — the precision an estimate this soft can carry. */
function nearestTen(n: number): number {
  return Math.round(n / 10) * 10;
}

// --- the library's order -------------------------------------------------------

/** Bucket edges, in days since the food was last eaten. */
export const BUCKET_WEEK_DAYS = 7;
export const BUCKET_MONTH_DAYS = 31;

export type MealsBucketKey = "week" | "month" | "earlier" | "never";

export interface MealsBucket {
  key: MealsBucketKey;
  label: string;
  foods: MealsFood[];
}

const BUCKET_LABELS: { key: MealsBucketKey; label: string }[] = [
  { key: "week", label: "this week" },
  { key: "month", label: "this month" },
  { key: "earlier", label: "earlier" },
  { key: "never", label: "never logged" },
];

/**
 * The whole library in the order every surface shows it: last eaten first, then
 * most eaten, then alphabetical. Nothing is ever deleted from this library — if
 * it was eaten once it will be eaten again — so recency is what keeps the
 * picker's first rows the food of this week, and a one-off from a year ago sinks
 * instead of squatting wherever it happened to be typed in.
 */
export function rankFoods(cfg: MealsConfig): MealsFood[] {
  return cfg.foods
    .map((food) => ({ food, ...foodUsage(cfg, food) }))
    .sort((a, b) => {
      if (a.lastUsed !== b.lastUsed) {
        // A food never logged has no place on the recency scale — it goes last.
        if (a.lastUsed === null) return 1;
        if (b.lastUsed === null) return -1;
        return a.lastUsed < b.lastUsed ? 1 : -1;
      }
      if (a.uses !== b.uses) return b.uses - a.uses;
      return a.food.name.localeCompare(b.food.name, undefined, {
        sensitivity: "base",
      });
    })
    .map((r) => r.food);
}

/** The library grouped by how recently it was eaten — always all four buckets,
 *  in order, so the caller decides what an empty one looks like (it skips it).
 *  Within a bucket the ranked order carries. */
export function bucketFoods(cfg: MealsConfig, today: string): MealsBucket[] {
  const groups: Record<MealsBucketKey, MealsFood[]> = {
    week: [],
    month: [],
    earlier: [],
    never: [],
  };
  for (const food of rankFoods(cfg))
    groups[bucketOf(foodUsage(cfg, food).lastUsed, today)].push(food);
  return BUCKET_LABELS.map(({ key, label }) => ({
    key,
    label,
    foods: groups[key],
  }));
}

function bucketOf(lastUsed: string | null, today: string): MealsBucketKey {
  if (lastUsed === null) return "never";
  const days = daysSinceYmd(lastUsed, today);
  if (days < BUCKET_WEEK_DAYS) return "week";
  return days < BUCKET_MONTH_DAYS ? "month" : "earlier";
}

/** Where a query matches a name, case-insensitively — the index the picker paints
 *  amber from. -1 for no match, and for an empty query (there is nothing to
 *  highlight, not a match at position zero). */
export function matchIndex(name: string, query: string): number {
  if (!query) return -1;
  return name.toLowerCase().indexOf(query.toLowerCase());
}

/**
 * The library filtered to what was typed, in ranked order, capped — an empty
 * query is "everything", which is what makes the freshly-opened picker a recent
 * list. `more` is what the cap cut, so the UI can say so rather than pretend the
 * library ends there.
 */
export function matchFoods(
  cfg: MealsConfig,
  query: string,
  limit: number,
): { foods: MealsFood[]; more: number } {
  const q = query.trim();
  const ranked = rankFoods(cfg);
  const hits = q ? ranked.filter((f) => matchIndex(f.name, q) >= 0) : ranked;
  return {
    foods: hits.slice(0, limit),
    more: Math.max(0, hits.length - limit),
  };
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
 * Interpret a macro/kcal field: non-negative numbers, decimals allowed to one
 * place (labels carry `.5`s, and per-unit math on a fraction of a pack produces
 * them constantly) — anything finer rounds, so the envelope never accumulates
 * float dust. `null` on anything else or past the cap. An empty or mid-retype
 * field is 0 — a food with no carbs is left blank, not typed as a zero.
 */
export function parseMacroInput(text: string): number | null {
  if (!/^\d*\.?\d*$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n > MAX_MACRO) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Interpret the weigh-in field: the kilos, or `null` for anything that isn't a
 * plain number in human range. A comma is read as a decimal point — the phone
 * keypad offers whichever the locale feels like, and a scale reading 67,2 is not
 * a typo. Finer than one decimal rounds rather than rejects: a scale that prints
 * three figures is offering precision the body doesn't have.
 *
 * A text field rather than `type="number"` for `parseQtyInput`'s reason — a
 * controlled number input snaps a cleared field straight back to 0.
 */
export function parseWeightInput(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const kg = Math.round(n * 10) / 10;
  return isKg(kg) ? kg : null;
}
