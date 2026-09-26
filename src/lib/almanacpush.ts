/**
 * almanacpush — the pure decider behind the almanac push category. Kept apart
 * from lib/push so the push core (and the /system panel that imports it) never
 * pulls in the aperture view code; the cron is the only caller.
 */

import { type AlmanacWindow } from "./aperture";
import { windowOpensOn } from "./apertureview";
import { daysBetween } from "./push";

/** How far ahead the almanac's early word lands — a week to act on it. */
export const ALMANAC_NOTICE_DAYS = 7;

export interface AlmanacPushResult {
  /** Send the push? */
  send: boolean;
  /** The line to send; empty unless `send`. */
  body: string;
  /** The marker the `almanac` key should carry after the check. */
  episode: string | undefined;
  reason: "quiet" | "notified" | "opens";
}

/**
 * Decide whether tonight the almanac speaks. It says exactly two things, and
 * only on the two days that matter: a window opens TODAY, or opens in exactly
 * `ALMANAC_NOTICE_DAYS`. Every opening falling on either day shares ONE line
 * (the digest's reasoning — two buzzes for one night teach the owner to mute
 * it), in the file's order. The almanac never nags on the page, and this is
 * the one place it speaks, at most once a day:
 *
 *  - `notified` — it already spoke today (a rerun of the cron). Silence.
 *  - `quiet`    — nothing opens today or a week out. The marker rides through
 *                 untouched, so a quiet night costs no write.
 *  - `opens`    — say it, and stamp today.
 */
export function checkAlmanacWindows(
  windows: readonly AlmanacWindow[],
  today: string,
  lastRun: string | undefined,
  noticeDays = ALMANAC_NOTICE_DAYS,
): AlmanacPushResult {
  if (lastRun === today)
    return { send: false, body: "", episode: lastRun, reason: "notified" };

  const lines: string[] = [];
  for (const w of windows) {
    const opens = windowOpensOn(w, today);
    if (opens === null) continue;
    if (opens === today) lines.push(`${w.name} opens today`);
    else if (daysBetween(today, opens) === noticeDays)
      lines.push(`${w.name} opens in ${noticeDays} days`);
  }
  if (lines.length === 0)
    return { send: false, body: "", episode: lastRun, reason: "quiet" };

  return {
    send: true,
    body: lines.join(" · "),
    episode: today,
    reason: "opens",
  };
}
