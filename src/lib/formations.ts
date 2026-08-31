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

export interface FormationRow {
  key: string;
  /** The formation's name, in the band's register. */
  name: string;
  /** What it is, plainly — the desktop detail column. */
  what: string;
  status: FormationStatus;
  /** The evidence label the row prints — "today", "3 days silent", "armed". */
  last: string;
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

  const tripwires: FormationRow = {
    key: "tripwires",
    name: "the tripwires",
    what: "push · ingest silence · chores · health · shares · sign-ins",
    status: ev.vapid === "ok" ? "armed" : ev.vapid === "off" ? "off" : "broken",
    last:
      ev.vapid === "ok"
        ? "armed"
        : ev.vapid === "off"
          ? "not configured"
          : "push broken — see /system",
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
