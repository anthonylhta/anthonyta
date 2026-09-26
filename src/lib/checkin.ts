import type { ApertureRefinement } from "./aperture";
import type { GuMarksConfig } from "./gumarks";

/**
 * checkin — the weekly check-in's six lines, pre-filled from what the page can
 * already read (`aperture/weekly-checkin.md`). The band on /aperture prints what
 * this renders; the owner reads it, corrects it, and pastes it. NOTHING here
 * adjudicates: every figure is a count of days or rows, and anything the page
 * cannot count is a `?` for the owner's own word rather than a guess.
 *
 * THE WINDOW IS THE SEVEN DAYS ENDING YESTERDAY. The seal day is excluded, so
 * today's entry counts next week (the 2026-09-09 seal's convention) — a check-in
 * sealed on Wednesday evening cannot honestly count a Wednesday that is still
 * being lived. Every day here is a Sydney calendar day as `YYYY-MM-DD`, which
 * compares lexically, so the whole module's date arithmetic is string work and
 * one UTC-midnight step (`dayBefore`).
 *
 * No `next` import and no DOM: the band is a client island, but this is unit
 * tested on its own like every other lib here.
 */

/** The seven days a check-in reads, oldest → newest, ending YESTERDAY. */
export interface CheckinWindow {
  /** The oldest day in the window. */
  from: string;
  /** The newest — the day before the seal day. */
  to: string;
  days: string[];
}

/** How many days a check-in covers. Fixed: the ritual is weekly. */
const WINDOW_DAYS = 7;

/** The calendar day before `ymd` (UTC-midnight math, DST-safe). */
export function dayBefore(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** A day as the block prints it — `MM-DD`, since the year is the header's. */
function md(day: string): string {
  return day.slice(5);
}

/** The window for a seal taken on `today`. */
export function checkinWindow(today: string): CheckinWindow {
  const days: string[] = [];
  let cursor = dayBefore(today);
  for (let i = 0; i < WINDOW_DAYS; i++) {
    days.push(cursor);
    cursor = dayBefore(cursor);
  }
  days.reverse();
  return { from: days[0], to: days[days.length - 1], days };
}

const DAILY_TITLE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a vault note title names a journal day (the daily-note convention). */
export function isDailyTitle(title: string): boolean {
  return DAILY_TITLE.test(title);
}

/** The journal's reading over a window: days written, and the ones that aren't. */
export interface JournalRead {
  count: number;
  /** The window days with no daily note, oldest → newest. */
  missed: string[];
}

/** Which of the window's days the vault index has a daily note for. */
export function journalDaysIn(
  titles: readonly string[],
  window: CheckinWindow,
): JournalRead {
  const written = new Set(titles.filter(isDailyTitle));
  const missed = window.days.filter((d) => !written.has(d));
  return { count: window.days.length - missed.length, missed };
}

/** The dated rows that fall inside a window, oldest → newest. Duplicates stay:
 *  two sessions on one day are two sessions. */
export function datesIn(
  dates: readonly string[],
  window: CheckinWindow,
): string[] {
  return dates
    .filter((d) => d >= window.from && d <= window.to)
    .sort((a, b) => a.localeCompare(b));
}

/** The tags a check-in collects out of the week's journal. */
const EVENT_TAG = /#(trial|evidence|stock|gu)\b/;

/** One journal day's markdown, for the event sweep. */
export interface CheckinNote {
  day: string;
  text: string;
}

/**
 * The week's `#trial` / `#evidence` / `#stock` / `#gu` lines, each stamped with
 * the day it was written on: `#evidence 09-14 — the line as written`. The line
 * is peeled of its list marker and its tag (the prefix already carries it) and
 * nothing else — the owner's words are the point.
 */
export function eventLines(notes: readonly CheckinNote[]): string[] {
  const out: string[] = [];
  for (const note of [...notes].sort((a, b) => a.day.localeCompare(b.day))) {
    for (const raw of note.text.split(/\r?\n/)) {
      const tag = EVENT_TAG.exec(raw);
      if (!tag) continue;
      const rest = raw
        .trim()
        .replace(/^[-*+]\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^\[[ xX]\]\s*/, "")
        .replace(EVENT_TAG, "")
        .replace(/^[\s—–:-]+/, "")
        .trim();
      out.push(`${tag[0]} ${md(note.day)}${rest ? ` — ${rest}` : ""}`);
    }
  }
  return out;
}

/**
 * Commit days inside the window, off the contributions strip: the levels run to
 * TODAY, so the window is everything but that last cell, and any level above
 * zero is a day something was pushed.
 */
export function commitDaysIn(
  levels: readonly number[],
  window: CheckinWindow,
): number {
  const end = levels.length - 1;
  return levels
    .slice(Math.max(0, end - window.days.length), Math.max(0, end))
    .filter((l) => l > 0).length;
}

/** The gu marks the seal has not folded in yet: a `since` the sealed entry does
 *  not carry. A mark on a name the book no longer holds is already spent — the
 *  check-in dropped the entry — so it is not pending anything. */
export function unsealedSince(
  cfg: GuMarksConfig,
  refining: readonly ApertureRefinement[],
): string[] {
  return refining
    .filter((r) => r.since === undefined && cfg.marks[r.name]?.since)
    .map((r) => r.name);
}

/** What the six lines are rendered from. A null is a gap the owner fills. */
export interface CheckinInput {
  /** The seal day — the week the block is headed with. */
  today: string;
  window: CheckinWindow;
  /** Null until the vault index has landed. */
  journal: JournalRead | null;
  /** Null until the fin envelope has opened. */
  finance: { buyDay: string | null; lastDay: string | null } | null;
  /** The window's session days; null until the gym log has landed. */
  gymDays: string[] | null;
  /** Null while the week's notes are still being read; empty is "none". */
  events: string[] | null;
  /** Applications logged in the window; null until the ledger has landed. */
  strikes: number | null;
}

/** The six lines, as the template writes them. */
export function checkinBlock(input: CheckinInput): string {
  const { window: w } = input;
  return [
    `## Aperture weekly — week ending ${input.today}`,
    `Journal: ${journalLine(input.journal, w)}`,
    `Finance ritual: ${financeLine(input.finance)}`,
    `Gym: ${gymLine(input.gymDays)}`,
    `Events: ${eventsLine(input.events)}`,
    `Wall strikes: ${strikeLine(input.strikes)}`,
    "Notes: ?",
  ].join("\n");
}

function journalLine(read: JournalRead | null, w: CheckinWindow): string {
  if (!read) return "?";
  const line = `${read.count}/${w.days.length}`;
  return read.missed.length === 0
    ? line
    : `${line} (missed ${read.missed.map(md).join(", ")})`;
}

function financeLine(
  fin: { buyDay: string | null; lastDay: string | null } | null,
): string {
  if (!fin) return "?";
  if (fin.buyDay !== null) return `done (buy ${md(fin.buyDay)})`;
  return fin.lastDay === null
    ? "? — no import yet"
    : `? — no import since ${md(fin.lastDay)}`;
}

function gymLine(days: string[] | null): string {
  if (!days) return "?";
  const count = `${days.length} session${days.length === 1 ? "" : "s"}`;
  return days.length === 0 ? count : `${count} (${days.map(md).join(", ")})`;
}

function eventsLine(lines: string[] | null): string {
  if (!lines) return "…";
  if (lines.length === 0) return "none";
  // The first line rides the label; the rest hang under it, indented, so the
  // block still pastes as one Events entry.
  return lines.map((l, i) => (i === 0 ? l : `  ${l}`)).join("\n");
}

function strikeLine(applications: number | null): string {
  const apps =
    applications === null
      ? "? applications"
      : `${applications} application${applications === 1 ? "" : "s"}`;
  return `${apps} · ? Ishin/validation actions`;
}

/** What the counters block is rendered from — the figures the seal also takes,
 *  beside the six lines rather than inside them. */
export interface CountersInput {
  window: CheckinWindow;
  /** Days pushed to, off the contributions strip; null when it isn't carried. */
  commitDays: number | null;
  gymSessions: number | null;
  mealDays: number | null;
  /** The distinct days the study log holds inside the window, oldest first;
   *  null until the log has answered. */
  studyDays: string[] | null;
  /** The gu book's pending marks; null until the marks store has answered. */
  marks: { since: string[]; casts: { name: string; date: string }[] } | null;
  /** Net worth off the fin envelope, all in cents; null while it is locked. The
   *  week's delta is null when the ledger does not reach back seven days. */
  wealth: {
    totalCents: number;
    investedCents: number;
    cashCents: number;
    hisaCents: number;
    weekDeltaCents: number | null;
  } | null;
}

/** The counters the check-in also takes, in the order it takes them. */
export function countersBlock(input: CountersInput): string {
  const { window: w } = input;
  const craft =
    input.commitDays === null
      ? "? commit days"
      : `+${input.commitDays} commit days (${md(w.from)}..${md(w.to)}, the github calendar)`;
  const training =
    input.gymSessions === null
      ? "? sessions"
      : `+${input.gymSessions} sessions`;
  const meals =
    input.mealDays === null
      ? "? days logged"
      : `+${input.mealDays} days logged`;
  const japanese =
    input.studyDays === null
      ? "? study days"
      : input.studyDays.length === 0
        ? "+0 study days"
        : `+${input.studyDays.length} study days (${input.studyDays.map(md).join(", ")})`;
  return [
    `Craft: ${craft}`,
    `Japanese: ${japanese}`,
    `Training: ${training} · Meals: ${meals}`,
    `Net worth: ${wealthLine(input.wealth)}`,
    `gu marks unsealed: ${marksLine(input.marks)}`,
    "platform: ? (bait held · bar met · bar spoken)",
  ].join("\n");
}

function marksLine(marks: CountersInput["marks"]): string {
  if (!marks) return "? · casts unsealed: ?";
  const since =
    marks.since.length === 0
      ? "none"
      : `${marks.since.length} (${marks.since.join(" · ")})`;
  const casts =
    marks.casts.length === 0
      ? "none"
      : `${marks.casts.length} (${marks.casts.map((c) => `${c.name} ${md(c.date)}`).join(" · ")})`;
  return `${since} · casts unsealed: ${casts}`;
}

function wealthLine(wealth: CountersInput["wealth"]): string {
  if (!wealth) return "?";
  const week =
    wealth.weekDeltaCents === null ? "?" : signedDollars(wealth.weekDeltaCents);
  return (
    `${dollars(wealth.totalCents)} (invested ${dollars(wealth.investedCents)}` +
    ` · cash ${dollars(wealth.cashCents)} · HISA ${dollars(wealth.hisaCents)})` +
    ` · wk ${week}`
  );
}

/** Whole dollars with thousands separators — `2000012` → `$20,000`. Written out
 *  rather than through `Intl` so the block never shifts with the device locale. */
function dollars(cents: number): string {
  const whole = Math.round(Math.abs(cents) / 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 && whole > 0 ? "-" : ""}$${grouped}`;
}

/** A delta always carries its sign; a week that rounds to nothing is `+$0`. */
function signedDollars(cents: number): string {
  const text = dollars(cents);
  return text.startsWith("-") ? text : `+${text}`;
}
