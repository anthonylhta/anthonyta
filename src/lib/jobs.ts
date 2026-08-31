import { isValidSeq } from "./seqrule";

/**
 * jobs — the pure spine of the application ledger (ADR 0166). Types, the strict
 * normalizer for the sealed `meta/jobs` envelope, and the transforms /jobs and
 * the /aperture sect-search line render from. No `next` import, no I/O — the
 * store wrapper (jobsstore) and the island own those.
 *
 * The model is a LOG: an application is its event list, and nothing else — no
 * separate status field to drift. An app is closed exactly when its latest
 * terminal event says so (`outcomeOf`); everything derived (age, quiet, the
 * funnel, the sect line) reads off the same events.
 */

export const JOBS_MAX_BYTES = 262_144;
export const JOBS_ENVELOPE_OVERHEAD = 128;

/** Client-side law: the ledger refuses new applications past this, with a
 *  reason — history is the point, so nothing is ever silently evicted. */
export const MAX_APPS = 500;
/** Normalize tolerates a little past the law (an older cap could have differed);
 *  beyond this the doc is malformed, not big. */
const MAX_APPS_SLACK = 600;
const MAX_EVENTS_PER_APP = 80;

/** Days without an event before an active application reads as gone quiet. */
export const QUIET_DAYS = 14;
/** The filter input appears once the ledger has more rows than this. */
export const FILTER_MIN = 15;
/** The funnel line appears once this many applications have closed. */
export const FUNNEL_MIN_CLOSED = 10;

/** Everything that can happen to an application, in the ledger's own words.
 *  CLOSED vocabulary — an unknown kind rejects the document (the MAJOR_TIERS
 *  discipline), because a kind the render can't read is a row it would lie
 *  about. */
export const EVENT_KINDS = [
  "applied",
  "screen",
  "assessment",
  "tech",
  "interview",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "ghosted",
] as const;
export type JobEventKind = (typeof EVENT_KINDS)[number];
const KIND_SET = new Set<string>(EVENT_KINDS);

/** The kinds that close an application. */
const TERMINAL = new Set<JobEventKind>([
  "accepted",
  "rejected",
  "withdrawn",
  "ghosted",
]);

/** Kinds that mean a conversation actually started — the sect line's "in trial"
 *  and the funnel's screened/interviewed stages read these. */
const SCREENED = new Set<JobEventKind>(["screen", "assessment"]);
const INTERVIEWED = new Set<JobEventKind>(["tech", "interview"]);

export interface JobEvent {
  /** YYYY-MM-DD */
  date: string;
  kind: JobEventKind;
  note?: string;
}

export interface JobApp {
  id: string;
  company: string;
  /** May be empty — a minimally logged mass application is company + date. */
  role: string;
  url?: string;
  events: JobEvent[];
}

export interface JobsConfig {
  v: 1;
  /** Sealed write counter (58b rollback detection) — see lib/seqrule. */
  seq?: number;
  apps: JobApp[];
}

export const EMPTY_JOBS_CONFIG: JobsConfig = { v: 1, apps: [] };

// --- normalize (strict: absent optional stays absent, malformed rejects) ------

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function isStr(x: unknown, max: number): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= max;
}
const DAY_ISO = /^\d{4}-\d{2}-\d{2}$/;
function isDay(x: unknown): x is string {
  return (
    typeof x === "string" && DAY_ISO.test(x) && Number.isFinite(Date.parse(x))
  );
}

function normEvent(x: unknown): JobEvent | null {
  if (!isObj(x)) return null;
  if (!isDay(x.date)) return null;
  if (typeof x.kind !== "string" || !KIND_SET.has(x.kind)) return null;
  if (x.note !== undefined && !isStr(x.note, 200)) return null;
  return {
    date: x.date,
    kind: x.kind as JobEventKind,
    ...(x.note !== undefined ? { note: x.note as string } : {}),
  };
}

function normApp(x: unknown): JobApp | null {
  if (!isObj(x)) return null;
  if (!isStr(x.id, 64) || !isStr(x.company, 120)) return null;
  // Role may be empty (a minimal mass-application row), but never junk.
  if (typeof x.role !== "string" || x.role.length > 160) return null;
  if (
    x.url !== undefined &&
    !(isStr(x.url, 300) && /^https?:\/\//.test(x.url as string))
  )
    return null;
  if (!Array.isArray(x.events) || x.events.length > MAX_EVENTS_PER_APP)
    return null;
  const events: JobEvent[] = [];
  for (const e of x.events) {
    const n = normEvent(e);
    if (n === null) return null;
    events.push(n);
  }
  return {
    id: x.id,
    company: x.company,
    role: x.role,
    ...(x.url !== undefined ? { url: x.url as string } : {}),
    events,
  };
}

export function normalizeJobsConfig(x: unknown): JobsConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!isValidSeq(x.seq)) return null;
  if (!Array.isArray(x.apps) || x.apps.length > MAX_APPS_SLACK) return null;
  const apps: JobApp[] = [];
  const ids = new Set<string>();
  for (const a of x.apps) {
    const n = normApp(a);
    if (n === null) return null;
    if (ids.has(n.id)) return null; // duplicate ids would make edits ambiguous
    ids.add(n.id);
    apps.push(n);
  }
  return {
    v: 1,
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
    apps,
  };
}

// --- reading the log ----------------------------------------------------------

/** The application's latest event — by date, ties going to the later entry (the
 *  order it was logged in). Null on an event-free row. */
export function lastEvent(app: JobApp): JobEvent | null {
  let last: JobEvent | null = null;
  for (const e of app.events)
    if (last === null || e.date >= last.date) last = e;
  return last;
}

/** The terminal kind that closed this application, or null while it's live —
 *  the latest terminal event wins, so a re-opened conversation can be logged by
 *  simply logging past it. */
export function outcomeOf(app: JobApp): JobEventKind | null {
  let out: JobEvent | null = null;
  for (const e of app.events)
    if (TERMINAL.has(e.kind) && (out === null || e.date >= out.date)) out = e;
  if (out === null) return null;
  const last = lastEvent(app);
  // A non-terminal event logged after the terminal one re-opens the row.
  if (last !== null && last.date > out.date && !TERMINAL.has(last.kind))
    return null;
  return out.kind;
}

export function isActive(app: JobApp): boolean {
  return outcomeOf(app) === null;
}

/** Whole days between two YYYY-MM-DD days (b ≥ a → ≥ 0). */
export function daysSince(day: string, today: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000),
  );
}

/** Active rows as a CHASE LIST: oldest last event first, so what most needs
 *  chasing sits on top and fresh activity sinks. Event-free rows first (they've
 *  been quiet since before time), ties by company. */
export function sortActive(apps: JobApp[]): JobApp[] {
  return apps
    .filter(isActive)
    .slice()
    .sort((a, b) => {
      const da = lastEvent(a)?.date ?? "";
      const db = lastEvent(b)?.date ?? "";
      return da.localeCompare(db) || a.company.localeCompare(b.company);
    });
}

/** Closed rows newest first — the recent verdicts on top of the pile. */
export function sortClosed(apps: JobApp[]): JobApp[] {
  return apps
    .filter((a) => !isActive(a))
    .slice()
    .sort((a, b) => {
      const da = lastEvent(a)?.date ?? "";
      const db = lastEvent(b)?.date ?? "";
      return db.localeCompare(da) || a.company.localeCompare(b.company);
    });
}

/** Case-insensitive substring filter over company + role; blank → everything. */
export function filterApps(apps: JobApp[], q: string): JobApp[] {
  const needle = q.trim().toLowerCase();
  if (needle === "") return apps;
  return apps.filter(
    (a) =>
      a.company.toLowerCase().includes(needle) ||
      a.role.toLowerCase().includes(needle),
  );
}

/** The response funnel — where 100 applications pays back: how many ever got a
 *  screen, an interview, an offer. Counted per APPLICATION, not per event. */
export function funnel(apps: JobApp[]): {
  applied: number;
  screened: number;
  interviewed: number;
  offers: number;
} {
  let screened = 0;
  let interviewed = 0;
  let offers = 0;
  for (const a of apps) {
    if (a.events.some((e) => SCREENED.has(e.kind))) screened++;
    if (a.events.some((e) => INTERVIEWED.has(e.kind))) interviewed++;
    if (a.events.some((e) => e.kind === "offer" || e.kind === "accepted"))
      offers++;
  }
  return { applied: apps.length, screened, interviewed, offers };
}

/** Closed rows bucketed by verdict, zero-count kinds omitted. */
export function closedCounts(apps: JobApp[]): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const a of apps) {
    const o = outcomeOf(a);
    if (o !== null) out[o] = (out[o] ?? 0) + 1;
  }
  return out;
}

/** The /aperture sect-search line's three figures (derived client-side — the
 *  dot-rider pattern; never check-in-emitted). "In trial" = a conversation
 *  actually started: any screen, assessment or interview event on a live row. */
export function sectSearch(apps: JobApp[]): {
  underway: number;
  inTrial: number;
  turnedAway: number;
} {
  let underway = 0;
  let inTrial = 0;
  let turnedAway = 0;
  for (const a of apps) {
    if (isActive(a)) {
      underway++;
      if (a.events.some((e) => SCREENED.has(e.kind) || INTERVIEWED.has(e.kind)))
        inTrial++;
    } else turnedAway++;
  }
  return { underway, inTrial, turnedAway };
}

// --- transforms (pure; the island seals + PUTs what these return) -------------

function rebuild(cfg: JobsConfig, apps: JobApp[]): JobsConfig {
  return {
    v: 1,
    ...(cfg.seq !== undefined ? { seq: cfg.seq } : {}),
    apps,
  };
}

/** Append a new application — null at the cap (refuse with a reason, never
 *  evict: the log IS the point). */
export function addApp(cfg: JobsConfig, app: JobApp): JobsConfig | null {
  if (cfg.apps.length >= MAX_APPS) return null;
  return rebuild(cfg, [...cfg.apps, app]);
}

/** Log an event onto one application; an unknown id no-ops. */
export function addEvent(
  cfg: JobsConfig,
  id: string,
  event: JobEvent,
): JobsConfig {
  return rebuild(
    cfg,
    cfg.apps.map((a) =>
      a.id === id ? { ...a, events: [...a.events, event] } : a,
    ),
  );
}

/** Remove one application entirely (a mis-entry; the UI two-taps this). */
export function removeApp(cfg: JobsConfig, id: string): JobsConfig {
  return rebuild(
    cfg,
    cfg.apps.filter((a) => a.id !== id),
  );
}

/** What the payload weighs — what the cap message shows against. */
export function jobsPayloadBytes(cfg: JobsConfig): number {
  return new TextEncoder().encode(JSON.stringify(cfg)).length;
}

/** Whether this config still fits the envelope cap once sealed — the client
 *  refuses a save that wouldn't, rather than sending bytes the route will 404. */
export function fitsJobsCap(cfg: JobsConfig): boolean {
  return jobsPayloadBytes(cfg) + JOBS_ENVELOPE_OVERHEAD <= JOBS_MAX_BYTES;
}
