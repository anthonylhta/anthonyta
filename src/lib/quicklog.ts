/**
 * quicklog — the pure spine of the ⌘K log section: what the owner typed, read
 * as one write against a store the pages already own.
 *
 * The palette is a jump list, so a log line has to announce itself: a verb, a
 * space, a value. Anything else parses to `null` and the palette stays the jump
 * list it was — which is also why a lone `w` or `todo` is not an action, since
 * both are prefixes of navigation labels the owner may be halfway through
 * typing.
 *
 * Nothing here touches a store or a clock: the caller passes today's Sydney day
 * in, so the same query always parses the same way — and the rows the section
 * draws are just these labels.
 */

import { dayHeading } from "./meals";
import { MAX_TEXT } from "./todo";

/** One parsed log line — the write the section will make on ↵. */
export type QuickLogAction =
  | { kind: "weigh"; kg: number; day: string }
  | { kind: "todo"; text: string };

/**
 * Sane bodyweight, in kilos. Tighter than the meal log's own storage bounds
 * (20–300): the store has to accept any weigh-in a body could have, but a
 * palette that writes on ONE keystroke should refuse a fat-fingered `w 674`
 * rather than log it.
 */
const MIN_KG = 30;
const MAX_KG = 250;

/** `w 67.4` / `weigh 67` — one decimal at most, which is all a scale has. */
const WEIGH = /^(?:w|weigh)\s+(\d+(?:\.\d)?)$/i;

/** `todo <anything>` — the rest of the line, whatever it is. */
const TODO = /^todo\s+(\S.*)$/i;

/** Read a palette query as a log line, or `null` for "this is not one". */
export function parseQuickLog(
  query: string,
  today: string,
): QuickLogAction | null {
  const text = query.trim();

  const weigh = WEIGH.exec(text);
  if (weigh) {
    const kg = Number(weigh[1]);
    if (kg < MIN_KG || kg > MAX_KG) return null;
    return { kind: "weigh", kg, day: today };
  }

  const todo = TODO.exec(text);
  if (todo) {
    // Clipped to the list's own cap here, so the row shows exactly what will be
    // captured rather than a line the store will quietly shorten.
    const clean = todo[1].trim().slice(0, MAX_TEXT);
    if (clean) return { kind: "todo", text: clean };
  }

  return null;
}

/** The action row's text — what ↵ is about to do, spelled out. */
export function quickLogLabel(action: QuickLogAction): string {
  return action.kind === "weigh"
    ? `log weigh-in · ${action.kg} kg · ${dayHeading(action.day)}`
    : `capture · ${action.text}`;
}

/** The same row once it is written — held for a beat before the palette closes,
 *  so the ✓ is seen rather than merely assumed. */
export function quickLogSaved(action: QuickLogAction): string {
  return action.kind === "weigh"
    ? `saved ✓ weigh-in ${action.kg} kg · ${dayHeading(action.day)}`
    : `saved ✓ captured · ${action.text}`;
}
