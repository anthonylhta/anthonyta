/**
 * agenda — the pure spine of the E2EE schedule. Every upcoming event lives in ONE
 * sealed envelope at `meta/agenda` (the fin pattern's seventh outing), decrypted
 * and edited only in the browser behind the vault unlock. The server moves
 * ciphertext it never parses, so every size/shape cap here is CLIENT-side law —
 * the route can only check the envelope frame.
 *
 * This is the schedule's first home: there is no external calendar to sync with
 * and no recurrence engine. A repeating shift is repeated by hand (`+1` on the
 * row), which is one tap and keeps every event a fact rather than a rule that has
 * to be evaluated to be read.
 *
 * Ordering is DERIVED, not structural (the opposite of the meal log): events are
 * appended in whatever order they are entered and `upcoming` sorts by day and
 * time, because a schedule is read chronologically no matter how it was typed.
 * The past is dropped on a grace period rather than kept — `pruneEvents` rides
 * every save, and nothing on the page ever looks backwards.
 *
 * Every transform is re-runnable against a fresh base, because that is what the
 * 409 dance does: on a conflict the island refetches, re-applies the SAME pure
 * function, and PUTs again. So each one is idempotent on its own id — applying it
 * twice (or against a base that already has it) changes nothing.
 */

import { isValidSeq } from "./seqrule";

/** Envelope frame cap for the PUT — the same ceiling the meal log gets; two
 *  hundred events is a fraction of it, and the event cap binds long first. */
export const AGENDA_MAX_BYTES = 262_144;

/** Sealed-envelope overhead over the JSON payload, rounded UP: 4 magic + 12 IV +
 *  16 GCM tag + 4 header-length prefix + the meta header JSON (~50 bytes). The
 *  client budgets against this so the owner sees a refusal with a reason instead
 *  of the route's opaque 404 (which is all a frame check can give). */
export const AGENDA_ENVELOPE_OVERHEAD = 128;

/** Everything ahead plus a week of grace behind it — a fortnight's horizon over a
 *  pruned store never comes near this. */
export const MAX_EVENTS = 200;
const MAX_TITLE = 80;
const MAX_ID = 64;

/** One thing on the schedule. Times are optional: a date-only event is an all-day
 *  thing, and an `end` without a `start` is meaningless (and refused). */
export interface AgendaEvent {
  id: string;
  /** The Sydney calendar day it falls on, `YYYY-MM-DD`. */
  date: string;
  /** Wall-clock start, `HH:MM` 24h. */
  start?: string;
  /** Wall-clock end, `HH:MM` 24h — only meaningful beside a `start`. */
  end?: string;
  title: string;
}

export interface AgendaConfig {
  v: 1;
  events: AgendaEvent[];
  /** Sealed write counter (58b rollback detection) — see lib/seqrule. */
  seq?: number;
}

export const EMPTY_AGENDA_CONFIG: AgendaConfig = { v: 1, events: [] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isId(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= MAX_ID;
}

function isTitle(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= MAX_TITLE;
}

function isTime(x: unknown): x is string {
  if (typeof x !== "string" || !TIME_RE.test(x)) return false;
  return Number(x.slice(0, 2)) < 24 && Number(x.slice(3)) < 60;
}

function isEvent(x: unknown): x is AgendaEvent {
  return (
    isObj(x) &&
    isId(x.id) &&
    typeof x.date === "string" &&
    DATE_RE.test(x.date) &&
    isTitle(x.title) &&
    (x.start === undefined || isTime(x.start)) &&
    // An end alone says nothing — the pair is the only shape that reads.
    (x.end === undefined || (isTime(x.end) && x.start !== undefined))
  );
}

/** Strict parse of a decrypted config — null on anything unrecognizable, so a
 *  tampered payload reads as "cannot decrypt", never as an empty schedule. */
export function normalizeAgendaConfig(x: unknown): AgendaConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!Array.isArray(x.events) || x.events.length > MAX_EVENTS) return null;
  if (!x.events.every(isEvent)) return null;
  if (!isValidSeq(x.seq)) return null;
  // Carry `seq` through the rebuild — dropping it would reset the rollback
  // counter on every read (the prf-label lesson: a rebuild that forgets a field
  // it didn't know about silently deletes it).
  return {
    v: 1,
    events: x.events as AgendaEvent[],
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
  };
}

/** The config as it will be sealed, in bytes — what `fitsAgendaCap` budgets. */
export function agendaPayloadBytes(cfg: AgendaConfig): number {
  return new TextEncoder().encode(JSON.stringify(cfg)).length;
}

/** Whether this config still fits the envelope cap once sealed. The client
 *  refuses a save that wouldn't, rather than sending bytes the route will 404. */
export function fitsAgendaCap(cfg: AgendaConfig): boolean {
  return agendaPayloadBytes(cfg) + AGENDA_ENVELOPE_OVERHEAD <= AGENDA_MAX_BYTES;
}

// --- transforms ----------------------------------------------------------------

function rebuild(cfg: AgendaConfig, events: AgendaEvent[]): AgendaConfig {
  const next: AgendaConfig = { v: 1, events };
  if (cfg.seq !== undefined) next.seq = cfg.seq;
  return next;
}

/**
 * Add one event. An id already present is a no-op, so the 409 dance can re-run
 * it; an empty title is refused rather than stored blank. Appended wherever it
 * lands — `upcoming` does the ordering, so nothing here has to.
 */
export function addEvent(cfg: AgendaConfig, event: AgendaEvent): AgendaConfig {
  const title = event.title.trim().slice(0, MAX_TITLE);
  if (!title) return cfg;
  if (cfg.events.length >= MAX_EVENTS) return cfg;
  if (cfg.events.some((e) => e.id === event.id)) return cfg;
  return rebuild(cfg, [...cfg.events, { ...event, title }]);
}

/** Remove one event by id. An unknown id is a no-op (re-runnable). */
export function removeEvent(cfg: AgendaConfig, id: string): AgendaConfig {
  if (!cfg.events.some((e) => e.id === id)) return cfg;
  return rebuild(
    cfg,
    cfg.events.filter((e) => e.id !== id),
  );
}

/**
 * Drop everything before `beforeDate` — the island composes this into every save
 * with a cutoff a week behind today. A week of grace, then gone: nothing on the
 * page ever reads the past, so keeping it would only be ballast against the cap.
 * With nothing to drop the config comes back untouched (identity), so a save that
 * only prunes is still a no-op the 409 dance can re-run.
 */
export function pruneEvents(
  cfg: AgendaConfig,
  beforeDate: string,
): AgendaConfig {
  if (!cfg.events.some((e) => e.date < beforeDate)) return cfg;
  return rebuild(
    cfg,
    cfg.events.filter((e) => e.date >= beforeDate),
  );
}

// --- derived readings ----------------------------------------------------------

/** `n` calendar days after `ymd` (UTC-midnight math, DST-safe) — the activity.ts
 *  helper walked forwards, needed here because events are stored as days, not
 *  timestamps. */
function addDays(ymd: string, n: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** A week of grace behind today — how far back `pruneEvents` keeps. */
export const GRACE_DAYS = 7;

/** The cutoff every save prunes before, so the island holds no date math. */
export function pruneCutoff(today: string): string {
  return addDays(today, -GRACE_DAYS);
}

/**
 * Everything from `today` to `horizonDays` ahead, in reading order: by day, then
 * all-day things first (they bound the whole day), then by start time, then by
 * title so two events at the same minute never swap places between renders.
 *
 * Compares day STRINGS, deliberately: an event's `date` is already the Sydney
 * calendar day it belongs to, so re-bucketing it through a timezone could only
 * move it off the day it says it is (`meals.trailingProtein` and
 * `gym.sessionCounts` take the same approach — a date-keyed store needs no clock).
 */
export function upcoming(
  cfg: AgendaConfig,
  today: string,
  horizonDays = 14,
): AgendaEvent[] {
  const end = addDays(today, horizonDays);
  return cfg.events
    .filter((e) => e.date >= today && e.date <= end)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.start ?? "").localeCompare(b.start ?? "") ||
        a.title.localeCompare(b.title),
    );
}

/** The day chip: "today", "tmr", or the weekday ("wed"). Derived from the date
 *  string by UTC math — no clock is consulted, so the label can't disagree with
 *  the day the event says it is. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tmr";
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** The time column: a range, a single start, or nothing at all (all-day). */
export function timeLabel(event: AgendaEvent): string {
  if (event.start === undefined) return "";
  return event.end === undefined ? event.start : `${event.start}–${event.end}`;
}

// --- input parsing -------------------------------------------------------------

/**
 * Interpret a time field: `null` rejects it, otherwise the zero-padded `HH:MM` to
 * store. An empty field is `null` too — the caller reads that as "no time" (an
 * all-day event) rather than as a rejection, which is why a half-typed `"7:"`
 * being null is harmless: the add button greys until the field is either blank or
 * whole.
 *
 * A text field rather than `type="time"`, on purpose: the native picker fights the
 * terminal look (the /transit hh:mm field carries the same scar), and a controlled
 * one snaps a cleared field back under the cursor.
 */
export function parseTimeInput(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}
