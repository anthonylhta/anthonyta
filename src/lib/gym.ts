/**
 * gym — the pure spine of the E2EE gym log. Sessions, the exercise catalog and
 * the templates all live in ONE sealed envelope at `meta/gym` (the fin pattern's
 * fifth outing), decrypted and edited only in the browser behind the vault
 * unlock. The server moves ciphertext it never parses, so every size/shape cap
 * here is CLIENT-side law — the route can only check the envelope frame.
 *
 * Ordering is structural, not sorted: `addSession` PREPENDS, so `sessions` is
 * newest-first by construction and eviction takes from the TAIL. Nothing ever
 * re-sorts by date — `date` is what the session says about itself, not a key —
 * which is what lets `lastSetsFor` and `e1rmSeries` read the log by walking it.
 *
 * Every transform is re-runnable against a fresh base, because that is what the
 * 409 dance does: on a conflict the island refetches, re-applies the SAME pure
 * function, and PUTs again. So each one is idempotent on its own id — applying
 * it twice (or against a base that already has it) changes nothing.
 */

import { isValidSeq } from "./seqrule";

/** Envelope frame cap for the PUT — a few hundred sessions of sets fit inside it
 *  with room to spare (a 400-session log of 6 exercises is well under 100KB). */
export const GYM_MAX_BYTES = 262_144;

/** Sealed-envelope overhead over the JSON payload, rounded UP: 4 magic + 12 IV +
 *  16 GCM tag + 4 header-length prefix + the meta header JSON (~50 bytes). The
 *  client budgets against this so the owner sees a refusal with a reason instead
 *  of the route's opaque 404 (which is all a frame check can give). */
export const GYM_ENVELOPE_OVERHEAD = 128;

export const MAX_SESSIONS = 400;
const MAX_EXERCISES = 200;
const MAX_TEMPLATES = 40;
/** Per session — exercises done, and sets per exercise. */
const MAX_ENTRIES = 40;
const MAX_SETS = 30;
const MAX_NAME = 60;
const MAX_NOTE = 500;
const MAX_ID = 64;
/** Plate math, not powerlifting records: kilograms, one machine's stack at most. */
const MAX_WEIGHT = 10_000;
const MAX_REPS = 1000;

/** One set: weight (kg, may be fractional — 2.5kg plates) × reps. Short keys
 *  because they repeat thousands of times inside one envelope. */
export interface GymSet {
  w: number;
  r: number;
}

/** One exercise within a session, and every set done of it. */
export interface GymEntry {
  exerciseId: string;
  sets: GymSet[];
}

export interface GymSession {
  id: string;
  /** The Sydney calendar day it was logged on, `YYYY-MM-DD`. */
  date: string;
  templateId?: string;
  entries: GymEntry[];
  note?: string;
}

export interface GymExercise {
  id: string;
  name: string;
}

export interface GymTemplate {
  id: string;
  name: string;
  /** Ordered — the builder lays the session out in this order. */
  exerciseIds: string[];
}

export interface GymConfig {
  v: 1;
  exercises: GymExercise[];
  templates: GymTemplate[];
  /** Newest-first by construction (see the module note). */
  sessions: GymSession[];
  /** Sealed write counter (58b rollback detection) — see lib/seqrule. */
  seq?: number;
}

export const EMPTY_GYM_CONFIG: GymConfig = {
  v: 1,
  exercises: [],
  templates: [],
  sessions: [],
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

function isSet(x: unknown): x is GymSet {
  return (
    isObj(x) &&
    typeof x.w === "number" &&
    Number.isFinite(x.w) &&
    x.w >= 0 &&
    x.w <= MAX_WEIGHT &&
    typeof x.r === "number" &&
    Number.isInteger(x.r) &&
    x.r >= 0 &&
    x.r <= MAX_REPS
  );
}

function isEntry(x: unknown): x is GymEntry {
  return (
    isObj(x) &&
    isId(x.exerciseId) &&
    Array.isArray(x.sets) &&
    x.sets.length <= MAX_SETS &&
    x.sets.every(isSet)
  );
}

function isSession(x: unknown): x is GymSession {
  return (
    isObj(x) &&
    isId(x.id) &&
    typeof x.date === "string" &&
    DATE_RE.test(x.date) &&
    (x.templateId === undefined || isId(x.templateId)) &&
    (x.note === undefined ||
      (typeof x.note === "string" && x.note.length <= MAX_NOTE)) &&
    Array.isArray(x.entries) &&
    x.entries.length <= MAX_ENTRIES &&
    x.entries.every(isEntry)
  );
}

function isExercise(x: unknown): x is GymExercise {
  return isObj(x) && isId(x.id) && isName(x.name);
}

function isTemplate(x: unknown): x is GymTemplate {
  return (
    isObj(x) &&
    isId(x.id) &&
    isName(x.name) &&
    Array.isArray(x.exerciseIds) &&
    x.exerciseIds.length <= MAX_ENTRIES &&
    x.exerciseIds.every(isId)
  );
}

/** Strict parse of a decrypted config — null on anything unrecognizable, so a
 *  tampered payload reads as "cannot decrypt", never as an empty log. */
export function normalizeGymConfig(x: unknown): GymConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!Array.isArray(x.exercises) || x.exercises.length > MAX_EXERCISES)
    return null;
  if (!x.exercises.every(isExercise)) return null;
  if (!Array.isArray(x.templates) || x.templates.length > MAX_TEMPLATES)
    return null;
  if (!x.templates.every(isTemplate)) return null;
  if (!Array.isArray(x.sessions) || x.sessions.length > MAX_SESSIONS)
    return null;
  if (!x.sessions.every(isSession)) return null;
  if (!isValidSeq(x.seq)) return null;
  // Carry `seq` through the rebuild — dropping it would reset the rollback
  // counter on every read (the prf-label lesson: a rebuild that forgets a field
  // it didn't know about silently deletes it on the next write).
  return {
    v: 1,
    exercises: x.exercises,
    templates: x.templates,
    sessions: x.sessions,
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
  };
}

/** The config as it will be sealed, in bytes — the figure the /gym readout
 *  shows against the cap, and what `fitsGymCap` budgets. */
export function gymPayloadBytes(cfg: GymConfig): number {
  return new TextEncoder().encode(JSON.stringify(cfg)).length;
}

/** Whether this config still fits the envelope cap once sealed. The client
 *  refuses a save that wouldn't, rather than sending bytes the route will 404. */
export function fitsGymCap(cfg: GymConfig): boolean {
  return gymPayloadBytes(cfg) + GYM_ENVELOPE_OVERHEAD <= GYM_MAX_BYTES;
}

// --- transforms ----------------------------------------------------------------

function rebuild(cfg: GymConfig, patch: Partial<GymConfig>): GymConfig {
  const next: GymConfig = {
    v: 1,
    exercises: cfg.exercises,
    templates: cfg.templates,
    sessions: cfg.sessions,
    ...patch,
  };
  if (cfg.seq !== undefined) next.seq = cfg.seq;
  return next;
}

/**
 * Prepend a finished session (newest first). Entries with no sets are dropped —
 * an exercise added to the builder and never loaded isn't part of the workout —
 * and a session left with nothing is a no-op. Past the cap the OLDEST session
 * (the tail) is evicted: a 400-session log losing its oldest day is the honest
 * trade for a fixed envelope, and the trailing strips only look back 10 weeks.
 *
 * Idempotent on `id`, so the 409 dance can re-run it against a fresh base that
 * may already contain it.
 */
export function addSession(cfg: GymConfig, session: GymSession): GymConfig {
  if (cfg.sessions.some((s) => s.id === session.id)) return cfg;
  const entries = session.entries.filter((e) => e.sets.length > 0);
  if (entries.length === 0) return cfg;
  const sessions = [{ ...session, entries }, ...cfg.sessions].slice(
    0,
    MAX_SESSIONS,
  );
  return rebuild(cfg, { sessions });
}

/**
 * Remove one session by id. An unknown id is a no-op, so the 409 dance can
 * re-run it against a fresh base another device may already have pruned. This
 * exists for exactly one honest reason: test and mis-logged sessions would
 * otherwise be permanent, and a junk heavy set poisons PR detection forever.
 */
export function removeSession(cfg: GymConfig, id: string): GymConfig {
  if (!cfg.sessions.some((s) => s.id === id)) return cfg;
  return rebuild(cfg, { sessions: cfg.sessions.filter((s) => s.id !== id) });
}

/**
 * Add one exercise to the catalog. A name already in the catalog (ignoring case
 * and surrounding space) is a no-op, as is an id already present — so this is
 * both duplicate-proof and re-runnable. The caller resolves an existing name to
 * its existing id BEFORE minting one, so a no-op here never orphans a draft.
 */
export function addExercise(
  cfg: GymConfig,
  id: string,
  name: string,
): GymConfig {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return cfg;
  if (cfg.exercises.length >= MAX_EXERCISES) return cfg;
  if (cfg.exercises.some((e) => e.id === id)) return cfg;
  if (findExerciseByName(cfg, clean) !== null) return cfg;
  return rebuild(cfg, { exercises: [...cfg.exercises, { id, name: clean }] });
}

/** Rename an exercise in place — every session entry references it by id, so
 *  the whole history follows the new name with nothing to migrate. */
export function renameExercise(
  cfg: GymConfig,
  id: string,
  name: string,
): GymConfig {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return cfg;
  if (!cfg.exercises.some((e) => e.id === id)) return cfg;
  return rebuild(cfg, {
    exercises: cfg.exercises.map((e) =>
      e.id === id ? { ...e, name: clean } : e,
    ),
  });
}

/**
 * Create or replace a template, keyed by id. An existing id is replaced IN PLACE
 * (the list's order is the owner's, not the edit history's); a new one appends.
 * Re-running it against a base that already has the same edit is a no-op by
 * construction — the replacement is the same value.
 */
export function upsertTemplate(
  cfg: GymConfig,
  template: GymTemplate,
): GymConfig {
  const name = template.name.trim().slice(0, MAX_NAME);
  if (!name) return cfg;
  const clean: GymTemplate = {
    ...template,
    name,
    exerciseIds: template.exerciseIds.slice(0, MAX_ENTRIES),
  };
  const at = cfg.templates.findIndex((t) => t.id === template.id);
  if (at >= 0) {
    const templates = [...cfg.templates];
    templates[at] = clean;
    return rebuild(cfg, { templates });
  }
  if (cfg.templates.length >= MAX_TEMPLATES) return cfg;
  return rebuild(cfg, { templates: [...cfg.templates, clean] });
}

export function removeTemplate(cfg: GymConfig, id: string): GymConfig {
  return rebuild(cfg, { templates: cfg.templates.filter((t) => t.id !== id) });
}

// --- derived readings ----------------------------------------------------------

/** An exercise's display name, or null when the id names nothing this config
 *  carries — the UI prints the honest miss rather than a blank. */
export function exerciseName(cfg: GymConfig, id: string): string | null {
  return cfg.exercises.find((e) => e.id === id)?.name ?? null;
}

export function templateName(cfg: GymConfig, id: string): string | null {
  return cfg.templates.find((t) => t.id === id)?.name ?? null;
}

/** The catalog id whose name matches (case/space-insensitively), or null. Lets
 *  the builder reuse an exercise the owner re-typed instead of duplicating it. */
export function findExerciseByName(
  cfg: GymConfig,
  name: string,
): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return (
    cfg.exercises.find((e) => e.name.trim().toLowerCase() === key)?.id ?? null
  );
}

/**
 * The sets from the most recent session that contains this exercise — the
 * "last: 60×8 · 60×8" line, and what the builder prefills from. Empty array for
 * an exercise never done: sessions are newest-first, so this is the first hit
 * walking forward, no sorting and no date parsing.
 */
export function lastSetsFor(cfg: GymConfig, exerciseId: string): GymSet[] {
  for (const s of cfg.sessions) {
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (entry && entry.sets.length > 0) return entry.sets;
  }
  return [];
}

/** The date of the most recent session containing this exercise, or null. */
export function lastDoneFor(cfg: GymConfig, exerciseId: string): string | null {
  for (const s of cfg.sessions)
    if (s.entries.some((e) => e.exerciseId === exerciseId)) return s.date;
  return null;
}

/**
 * The best set ever done of an exercise: heaviest weight, and at that weight the
 * most reps. Null for an exercise with no sets at all — which is why the FIRST
 * set of anything is never a PR (see `isPr`): there is nothing to beat yet.
 *
 * Weight-first is the deliberate simplification. It is not a 1RM estimate and
 * doesn't pretend to be: 100×1 outranks 60×20 here, which is how a "best set"
 * reads on a log sheet, and any formula would be a model the log can't verify.
 */
export function bestFor(cfg: GymConfig, exerciseId: string): GymSet | null {
  let best: GymSet | null = null;
  for (const s of cfg.sessions)
    for (const e of s.entries) {
      if (e.exerciseId !== exerciseId) continue;
      for (const set of e.sets)
        if (
          best === null ||
          set.w > best.w ||
          (set.w === best.w && set.r > best.r)
        )
          best = set;
    }
  return best;
}

/**
 * Whether a set beats the log: heavier than the best weight, or the same weight
 * for more reps. The first set of an exercise is NOT a PR — flagging it would
 * make every new exercise's opener an achievement, which cheapens the chip to
 * noise. `cfg` is the log BEFORE the set is added.
 */
export function isPr(set: GymSet, cfg: GymConfig, exerciseId: string): boolean {
  const best = bestFor(cfg, exerciseId);
  if (best === null) return false;
  return set.w > best.w || (set.w === best.w && set.r > best.r);
}

/**
 * Epley's estimated one-rep max, `w × (1 + r/30)` — the gym-floor formula, with a
 * single returned untouched: one rep IS a measured one-rep max, and running it
 * through the formula would inflate it by 3% over a number the log actually saw.
 * Zero (or fewer) reps is no lift at all, so it estimates nothing: 0.
 *
 * It is a MODEL, unlike everything else in this file — 100kg×5 reads as ~117kg,
 * which nobody has lifted. It earns its place anyway, because reps vary set to
 * set and comparing raw weights across sessions compares different efforts; one
 * estimate puts them on one scale. The `~` is worn everywhere it renders.
 */
export function epley(w: number, r: number): number {
  if (r <= 0) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

/**
 * The set of an exercise with the highest Epley estimate, with the day it was
 * done. Ties keep the MOST RECENT: sessions are newest-first, so a strict `>`
 * never lets an older equal set displace the newer one. Null only when the
 * exercise has no sets at all — `bestFor`'s "nothing to beat yet" state.
 *
 * This can name a set `bestFor` passes over, which is the whole point: 90×8
 * (~114) outranks 100×1 here, because it is the harder thing to have done.
 */
export function bestE1rm(
  cfg: GymConfig,
  exerciseId: string,
): { e1rm: number; set: GymSet; date: string } | null {
  let best: { e1rm: number; set: GymSet; date: string } | null = null;
  for (const s of cfg.sessions)
    for (const e of s.entries) {
      if (e.exerciseId !== exerciseId) continue;
      for (const set of e.sets) {
        const e1rm = epley(set.w, set.r);
        if (best === null || e1rm > best.e1rm)
          best = { e1rm, set, date: s.date };
      }
    }
  return best;
}

/**
 * The best estimated one-rep max per lift, heaviest first — the vessel's chip
 * line, the whole log read as one row of figures. Only exercises with a set
 * somewhere in the log appear: one added to the catalog and never done has
 * nothing to estimate, and a chip reading zero would be a claim about a lift
 * nobody performed.
 *
 * Sorted on the ROUNDED estimate, so two chips printing the same number sit in
 * name order rather than in an order the decimals decide and the eye can't see;
 * the name tiebreak makes the ordering total, so a redeploy can't reshuffle the
 * line. Every reading is Epley's model — the `~` it is worn under belongs to the
 * surface, exactly as it does everywhere else this estimate renders.
 *
 * The catalog `id` rides along so a chip can ask for its own lift's progression
 * (`e1rmSeries`) without matching back on a display name.
 */
export function liftChips(
  cfg: GymConfig,
  max = 6,
): { id: string; name: string; e1rm: number }[] {
  return cfg.exercises
    .flatMap((e) => {
      const best = bestE1rm(cfg, e.id);
      return best === null
        ? []
        : [{ id: e.id, name: e.name, e1rm: Math.round(best.e1rm) }];
    })
    .sort((a, b) => b.e1rm - a.e1rm || a.name.localeCompare(b.name))
    .slice(0, max);
}

// --- the in-progress draft -----------------------------------------------------

/**
 * A workout being built, before it becomes a session. It lives in the island's
 * state and is mirrored to `localStorage` under GYM_DRAFT_KEY.
 *
 * THE TRADEOFF, stated plainly: that mirror is PLAINTEXT. A set of sets is the
 * least sensitive thing the hub holds, and it is the one place gym data exists
 * unsealed. It is here for exactly one reason: closing or backgrounding the
 * phone tab mid-workout must not eat the workout — sessionStorage was tried
 * first and dies exactly when the insurance is needed (the owner closes the
 * site between exercises; ADR 0120). localStorage is shared across tabs, so
 * two tabs mid-draft would clobber each other — one owner, one workout at a
 * time. The durable home is the sealed envelope; the draft is a scratch pad,
 * cleared the moment the session saves or is discarded.
 */
export interface GymDraft {
  templateId?: string;
  entries: GymEntry[];
  note: string;
}

export const GYM_DRAFT_KEY = "gym-draft";

export const EMPTY_GYM_DRAFT: GymDraft = { entries: [], note: "" };

/**
 * Parse a stored draft — null on anything this build doesn't recognize. The real
 * case it defends is a tab that was left open across a deploy: a draft written by
 * an older shape must be dropped, never restored into a crash.
 */
export function parseDraft(json: string): GymDraft | null {
  let x: unknown;
  try {
    x = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(x)) return null;
  if (x.templateId !== undefined && !isId(x.templateId)) return null;
  if (typeof x.note !== "string" || x.note.length > MAX_NOTE) return null;
  if (
    !Array.isArray(x.entries) ||
    x.entries.length > MAX_ENTRIES ||
    !x.entries.every(isEntry)
  )
    return null;
  return {
    ...(x.templateId !== undefined ? { templateId: x.templateId } : {}),
    entries: x.entries,
    note: x.note,
  };
}

/** A draft, finished: the session `addSession` takes. An all-space note is
 *  dropped rather than stored as one — an empty note is no note. */
export function draftToSession(
  draft: GymDraft,
  id: string,
  date: string,
): GymSession {
  const note = draft.note.trim().slice(0, MAX_NOTE);
  return {
    id,
    date,
    ...(draft.templateId !== undefined ? { templateId: draft.templateId } : {}),
    entries: draft.entries,
    ...(note ? { note } : {}),
  };
}

/** Whether a draft holds anything worth saving (a card with no sets doesn't). */
export function draftHasSets(draft: GymDraft): boolean {
  return draft.entries.some((e) => e.sets.length > 0);
}

/**
 * The set a new row should start from: the previous set in THIS session if there
 * is one, else the corresponding set from the last time this exercise was done,
 * else zeroes. Repeating the last set is right far more often than not — the
 * steppers are there for when it isn't.
 */
export function prefillSet(
  cfg: GymConfig,
  exerciseId: string,
  soFar: GymSet[],
): GymSet {
  const previous = soFar[soFar.length - 1];
  if (previous) return { ...previous };
  const lastTime = lastSetsFor(cfg, exerciseId)[soFar.length];
  return lastTime ? { ...lastTime } : { w: 0, r: 0 };
}

/**
 * Interpret one keystroke's worth of a set field: `null` rejects the edit (not a
 * plain non-negative number — letters, signs, exponents, a second dot), otherwise
 * the value the draft should hold. An empty or bare-dot field is a field mid
 * retype, held as 0 until real digits land — the input keeps showing the empty
 * text, so clearing a field never snaps a 0 back under the cursor.
 */
export function parseSetInput(text: string, integer: boolean): number | null {
  if (!(integer ? /^\d*$/ : /^\d*\.?\d*$/).test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/** Total kg moved in a session — sets × reps × weight. The history summary's
 *  one number; crude on purpose (it can't know about tempo or range). */
export function sessionVolume(session: GymSession): number {
  let total = 0;
  for (const e of session.entries) for (const s of e.sets) total += s.w * s.r;
  return total;
}

/** Every session's day, newest-first (the array's own order). */
export function sessionDays(cfg: GymConfig): string[] {
  return cfg.sessions.map((s) => s.date);
}

/** The day of the most recent session, or null for an empty log — the head of a
 *  newest-first array (see the module note), so no sorting and no date parsing.
 *  What the needs-doing board ages the training cadence against. */
export function lastSessionDate(cfg: GymConfig): string | null {
  return cfg.sessions[0]?.date ?? null;
}

/** The calendar day before `ymd` (UTC-midnight math, DST-safe) — the activity.ts
 *  helper, needed here because gym days are stored as days, not timestamps. */
function prevDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Sessions per day over the trailing `days` window ending at `today`, oldest →
 * newest — the shape `toLevels` turns into an <ActivityStrip>.
 *
 * Counts by day STRING, deliberately: a session's `date` is already the Sydney
 * calendar day the device wrote it on, so re-bucketing it through a timezone
 * (what `activity.dailyCounts` does for timestamped sources) could only move it
 * off the day it says it is. This is `steps.trailingSeries`'s approach, for the
 * same reason — a date-keyed store needs no clock.
 */
export function sessionCounts(
  cfg: GymConfig,
  days: number,
  today: string,
): number[] {
  const perDay = new Map<string, number>();
  for (const s of cfg.sessions)
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
  const out: number[] = [];
  let cursor = today;
  for (let i = 0; i < days; i++) {
    out.push(perDay.get(cursor) ?? 0);
    cursor = prevDay(cursor);
  }
  return out.reverse();
}

/**
 * The week's training target every session count is read against — the owner's
 * own cadence, not a cap: nothing here refuses a fifth session. It lives beside
 * the count rather than beside one of its readers because two surfaces print it
 * (the needs-doing board and the vessel), and they must never disagree.
 */
export const GYM_WEEKLY_TARGET = 4;

/** How many sessions in the last 7 days INCLUDING today — a trailing week, not
 *  a Mon–Sun one, so the number never resets mid-training-week. Summing the
 *  7-day window keeps it true to the strip beside it by construction. */
export function sessionsThisWeek(cfg: GymConfig, todayISO: string): number {
  return sessionCounts(cfg, 7, todayISO).reduce((a, b) => a + b, 0);
}

/**
 * The best Epley estimate of every session containing this exercise, oldest →
 * newest — the progression the /gym exercises view sparklines, on the scale
 * that answers "am I getting stronger". Sessions with the exercise but no sets
 * contribute nothing: there is no lift to plot.
 *
 * It is the honest progression line where the top-set weight isn't. A week of
 * 60×12 after a week of 65×5 is progress, and drawn by weight alone it falls.
 */
export function e1rmSeries(cfg: GymConfig, exerciseId: string): number[] {
  const out: number[] = [];
  for (const s of cfg.sessions) {
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry || entry.sets.length === 0) continue;
    out.push(Math.max(...entry.sets.map((set) => epley(set.w, set.r))));
  }
  return out.reverse();
}

/**
 * Total kilograms moved per trailing 7-day window, oldest → newest, the newest
 * window ending at `today` INCLUSIVE: window k back from the end covers
 * `today-7k-6 … today-7k`. Exactly `weeks` long — a week with no training is a
 * real zero, not a gap in the line.
 *
 * Buckets by day STRING, and walks the calendar with `prevDay`, for
 * `sessionCounts`'s reason: a session's `date` is already the Sydney day it was
 * logged on, so no clock here can improve on it. Trailing windows rather than
 * Mon–Sun ones, so the newest bar is the week actually being trained and the one
 * before it is a fair comparison the moment a session lands.
 */
export function weeklyVolume(
  cfg: GymConfig,
  weeks: number,
  today: string,
): number[] {
  const perDay = new Map<string, number>();
  for (const s of cfg.sessions)
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + sessionVolume(s));
  const out: number[] = [];
  let cursor = today;
  for (let w = 0; w < weeks; w++) {
    let total = 0;
    for (let d = 0; d < 7; d++) {
      total += perDay.get(cursor) ?? 0;
      cursor = prevDay(cursor);
    }
    out.push(total);
  }
  return out.reverse();
}
