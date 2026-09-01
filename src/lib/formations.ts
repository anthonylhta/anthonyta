/**
 * formations — the pure spine of the 阵 band (ADR 0167): everything that runs
 * WITHOUT the owner, one row each, state derived from evidence the server
 * already holds (the chores philosophy — never self-reported). Owner-run
 * scripts (vault-sync, backup, aperture-sync) are deliberately absent: those
 * are actively cast, and they live on the needs-doing board.
 *
 * No I/O and no `next` import — the /aperture page reads the plaintext stores,
 * hands the newest evidence days in, and renders the rows verbatim.
 */

import { INGEST_SOURCES, type FiredKey } from "./push";

export type FormationStatus =
  /** turned on schedule */
  | "ok"
  /** a turn was missed beyond the formation's ordinary slack */
  | "due"
  /** two cadences gone — the formation has stopped */
  | "overdue"
  /** no evidence at all (a store never written) */
  | "unknown"
  /** the tripwires' own states — config facts, not cadences */
  | "armed"
  | "broken"
  | "off";

/** One line of the tripwires' firing ledger. `fired: false` renders as the
 *  dim "never" — not since the ledger was laid, which the note under the
 *  unfold says out loud. */
export interface FormationDetail {
  label: string;
  value: string;
  fired: boolean;
}

export interface FormationRow {
  key: string;
  /** The formation's name, in the band's register. */
  name: string;
  /** What it is, plainly — the desktop detail column. */
  what: string;
  status: FormationStatus;
  /** The evidence label the row prints — "today", "3 days silent", "armed". */
  last: string;
  /** The unfoldable firing ledger — only the tripwires row carries one, and
   *  only when the push config could be read (an unreadable store must not
   *  render as a row of nevers). */
  detail?: FormationDetail[];
}

/**
 * Days of silence each formation is allowed before its dot goes amber — "ok"
 * covers the gap ordinary life produces, "due" means a real turn was missed.
 * Briefing/cron/steps get 1 (yesterday's run is still ok — today's may simply
 * not have happened yet on a page read at 7am); sleep gets 2 (a watch-less
 * night is ordinary — the push machinery's STALE_AFTER_DAYS precedent).
 * Overdue at double the allowance, mirroring the chores engine.
 */
export const FORMATION_SLACK_DAYS: Readonly<Record<string, number>> = {
  briefing: 1,
  cron: 1,
  steps: 1,
  sleep: 2,
};

/** Whole days between two YYYY-MM-DD days, floored at zero. */
function daysBetweenDays(day: string, today: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000),
  );
}

/** A cadenced formation's status + label from its newest evidence day. */
export function formationState(
  newestDay: string | null,
  slackDays: number,
  today: string,
): { status: FormationStatus; last: string } {
  if (newestDay === null || Number.isNaN(Date.parse(newestDay)))
    return { status: "unknown", last: "no record" };
  const age = daysBetweenDays(newestDay, today);
  const status: FormationStatus =
    age > slackDays * 2 + 1 ? "overdue" : age > slackDays ? "due" : "ok";
  const last =
    age === 0 ? "today" : age === 1 ? "yesterday" : `${age} days silent`;
  return { status, last };
}

export interface FormationEvidence {
  /** The Sydney day the stored briefing is FOR — its own date stamp. */
  briefingDay: string | null;
  /** The reading index's newest day — the nightly cron's own first write. */
  cronDay: string | null;
  /** Newest recorded day in the steps store. */
  stepsDay: string | null;
  /** Newest recorded wake-date in the sleep store. */
  sleepDay: string | null;
  /** The push trio's verdict — `vapidStatus`'s three states. */
  vapid: "ok" | "misconfigured" | "off";
  /** The push config's fired ledger — null when the config couldn't be read,
   *  which drops the unfold entirely rather than faking a row of nevers. */
  fired: Partial<Record<FiredKey, string>> | null;
}

/** The ledger register's short age: "today", then days, then weeks (the
 *  agoLabel switch point). */
function firedAge(day: string, today: string): string {
  const age = daysBetweenDays(day, today);
  if (age === 0) return "today";
  return age < 14 ? `${age}d ago` : `${Math.floor(age / 7)}w ago`;
}

/**
 * The tripwires' firing ledger: one line per wire, plus the newest day across
 * all of them for the row's own "spoke" suffix. The three ingest sources fold
 * to ONE silence line naming the source that spoke most recently — which
 * silence was announced matters, three lines of mostly-never would not.
 */
function tripwireLedger(
  fired: Partial<Record<FiredKey, string>>,
  today: string,
): { detail: FormationDetail[]; newest: string | null } {
  const line = (
    label: string,
    day: string | undefined,
    suffix = "",
  ): FormationDetail => ({
    label,
    value: day === undefined ? "never" : `${firedAge(day, today)}${suffix}`,
    fired: day !== undefined,
  });

  let silenceDay: string | undefined;
  let silenceSource = "";
  for (const s of INGEST_SOURCES) {
    const d = fired[s];
    if (d !== undefined && (silenceDay === undefined || d > silenceDay)) {
      silenceDay = d;
      silenceSource = s;
    }
  }

  const detail = [
    line("mail", fired.dropbox),
    line("the door", fired.signin),
    line("share", fired.share),
    line("silence", silenceDay, silenceSource && ` · ${silenceSource}`),
    line("upkeep", fired.chores),
    line("health", fired.health),
  ];
  const days = Object.values(fired).filter((d): d is string => d !== undefined);
  const newest =
    days.length === 0 ? null : days.reduce((a, b) => (a > b ? a : b));
  return { detail, newest };
}

/** The band's five rows, in reading order. Always all five — this band's whole
 *  point is that an absent row can't go amber (the briefing-skip lesson). */
export function formationRows(
  ev: FormationEvidence,
  today: string,
): FormationRow[] {
  const cadenced = (
    key: string,
    name: string,
    what: string,
    day: string | null,
  ): FormationRow => ({
    key,
    name,
    what,
    ...formationState(day, FORMATION_SLACK_DAYS[key], today),
  });

  const ledger = ev.fired === null ? null : tripwireLedger(ev.fired, today);
  const tripwires: FormationRow = {
    key: "tripwires",
    name: "the tripwires",
    what: "push · ingest silence · chores · health · shares · sign-ins",
    status: ev.vapid === "ok" ? "armed" : ev.vapid === "off" ? "off" : "broken",
    // The armed row carries the newest firing so the band can say the wires
    // are REAL, not just configured; a broken or off trio keeps its own
    // message — history is context there, not a headline.
    last:
      ev.vapid === "ok"
        ? ledger?.newest
          ? `armed · spoke ${firedAge(ledger.newest, today)}`
          : "armed"
        : ev.vapid === "off"
          ? "not configured"
          : "push broken — see /system",
    ...(ledger !== null ? { detail: ledger.detail } : {}),
  };

  return [
    cadenced(
      "briefing",
      "the courier",
      "briefing routine · cloud, daily 8am",
      ev.briefingDay,
    ),
    cadenced(
      "cron",
      "the night ledger",
      "cron · reading index · share sweep · lp history · tripwire checks",
      ev.cronDay,
    ),
    cadenced(
      "steps",
      "the walking tally",
      "mandosteps · steps, hourly + on open",
      ev.stepsDay,
    ),
    cadenced(
      "sleep",
      "the sleep watcher",
      "mandosteps · nights, at the morning sync",
      ev.sleepDay,
    ),
    tripwires,
  ];
}
