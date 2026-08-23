import type { VaultIndexNote } from "./vaultblob";

/**
 * on this day — the pure matcher behind the vault reader's resurfacing band
 * (roadmap 82b). The journal is the one store that pays dividends by being
 * re-read, and nothing ever re-reads it: the index is newest-first, so a year of
 * entries sits below the fold forever. This module answers one question against
 * the ALREADY-decrypted index — which daily note, if any, is exactly one month
 * and exactly one year old — so the band above the list is a slice of data the
 * browser already holds. The server learns nothing it did not already store.
 *
 * `today` is injected as a Sydney calendar day (`YYYY-MM-DD`), never read from a
 * clock in here: the caller owns the timezone, and the matcher stays a function
 * of its arguments.
 */

/** A vault daily note's title is its Sydney calendar day, and nothing else is —
 *  the same rule `latestDailyDay` reads the journal edge by. A target day is
 *  itself a validated `YYYY-MM-DD`, so an exact title match IS that predicate. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The two windows the band resurfaces, each holding the daily note for that day
 *  when the journal has one. A window with no note is simply absent — there is no
 *  empty state to render. */
export interface OnThisDay {
  monthAgo?: VaultIndexNote;
  yearAgo?: VaultIndexNote;
}

/** Days in `month` (1-12) of `year`, leap rules included — day 0 of the next
 *  month is the last day of this one, reckoned in UTC so no clock is involved. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * The same day-of-month one month or one year before `today`, or null when that
 * date does not exist on the calendar — the 31st of a 30-day month, 29 February
 * in a common year. Nothing is approximated: sliding onto the 28th would quietly
 * resurface a different day and call it an anniversary. A `today` that isn't a
 * real date is null for the same reason.
 */
export function anniversaryDay(
  today: string,
  unit: "month" | "year",
): string | null {
  const m = DAY.exec(today);
  if (m === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;

  const year = unit === "year" ? y - 1 : mo === 1 ? y - 1 : y;
  const month = unit === "year" ? mo : mo === 1 ? 12 : mo - 1;
  if (d > daysInMonth(year, month)) return null;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(d, 2)}`;
}

/**
 * The daily notes one month and one year old, from the decrypted index. First
 * match wins on a duplicated title, over an index that arrives newest-first
 * (`compareIndexNotes`) — the reader's own duplicate rule, so a title that names
 * two notes resurfaces the same one the wikilinks resolve to.
 */
export function onThisDay(notes: VaultIndexNote[], today: string): OnThisDay {
  const out: OnThisDay = {};
  for (const unit of ["month", "year"] as const) {
    const day = anniversaryDay(today, unit);
    const hit = day === null ? undefined : notes.find((n) => n.title === day);
    if (hit) out[unit === "month" ? "monthAgo" : "yearAgo"] = hit;
  }
  return out;
}
