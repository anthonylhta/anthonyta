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

import { MAX_NAME as MAX_CAST_NAME } from "./gumarks";
import { dayHeading } from "./meals";
import { aud } from "./money";
import { MAX_NOW_KEY, MAX_NOW_TEXT } from "./now";
import { MAX_STUDY_MINUTES, MAX_STUDY_SOURCE } from "./study";
import { MAX_TEXT } from "./todo";

/** One parsed log line — the write the section will make on ↵. */
export type QuickLogAction =
  | { kind: "weigh"; kg: number; day: string }
  | { kind: "todo"; text: string }
  | { kind: "now"; key: string; text: string }
  /** `stones` in cents, the gu book's unit. */
  | { kind: "cast"; name: string; stones: number; day: string }
  | { kind: "study"; source: string; minutes?: number; day: string };

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

/** `now <key> <the sentence>` — the front door's block, one line at a time. */
const NOW = /^now\s+(\S+)\s+(\S.*)$/i;

/** `cast <what> <dollars>` — the name is everything up to the last figure, so a
 *  name may carry spaces, dashes and numbers of its own. */
const CAST = /^cast\s+(\S.*?)\s+(\d+(?:\.\d{1,2})?)$/i;
/** The book's stones bound — a cast of ten million dollars is a typo. */
const MAX_STONES = 1e9;

/** `ja <what was studied>` with an optional trailing `20m` / `20 min`. */
const JA = /^ja\s+(\S.*)$/i;
const JA_MINUTES = /^(?:(.*?)\s+)?(\d+)\s*(?:m|min)$/i;

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

  const ja = JA.exec(text);
  if (ja) {
    let source = ja[1].trim();
    let minutes: number | undefined;
    const timed = JA_MINUTES.exec(source);
    if (timed) {
      minutes = Number(timed[2]);
      // A sitting of no minutes, or ten hours, is a typo — refused, not logged.
      if (minutes < 1 || minutes > MAX_STUDY_MINUTES) return null;
      source = (timed[1] ?? "").trim();
    }
    // Clipped to the log's own cap, the `todo` way; a bare duration names
    // nothing studied, so it is not a line yet.
    source = source.slice(0, MAX_STUDY_SOURCE);
    if (source)
      return {
        kind: "study",
        source,
        ...(minutes !== undefined ? { minutes } : {}),
        day: today,
      };
  }

  const now = NOW.exec(text);
  if (now) {
    // Both halves are REFUSED rather than clipped when they're too long: unlike
    // a capture, this line is published on the public front door, and a row that
    // silently lost its last clause — or landed under a key the owner didn't
    // quite type — is worse than a palette that says nothing yet.
    const key = now[1].trim().toLowerCase();
    const line = now[2].trim();
    if (key.length > MAX_NOW_KEY || line.length > MAX_NOW_TEXT) return null;
    if (key && line) return { kind: "now", key, text: line };
  }

  const cast = CAST.exec(text);
  if (cast) {
    // Refused past the cap, not clipped (the `now` precedent): the check-in
    // folds a cast by its name, so a shortened one would never match its seal.
    const name = cast[1].trim();
    const stones = Math.round(Number(cast[2]) * 100);
    if (name.length > MAX_CAST_NAME || stones >= MAX_STONES) return null;
    if (name) return { kind: "cast", name, stones, day: today };
  }

  return null;
}

/** A long line, cut to fit the palette's one row. */
function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The action row's text — what ↵ is about to do, spelled out. */
export function quickLogLabel(action: QuickLogAction): string {
  switch (action.kind) {
    case "weigh":
      return `log weigh-in · ${action.kg} kg · ${dayHeading(action.day)}`;
    case "todo":
      return `capture · ${action.text}`;
    case "now":
      return `set now · ${action.key} · ${clip(action.text)}`;
    case "cast":
      return `cast · ${clip(action.name)} · ${aud(action.stones / 100)} · ${dayHeading(action.day)}`;
    case "study":
      return `study · ${studyText(action)}`;
  }
}

/** A sitting's middle — what, how long when said, and the day. */
function studyText(action: Extract<QuickLogAction, { kind: "study" }>): string {
  const mins = action.minutes !== undefined ? ` · ${action.minutes} min` : "";
  return `${clip(action.source)}${mins} · ${dayHeading(action.day)}`;
}

/** The same row once it is written — held for a beat before the palette closes,
 *  so the ✓ is seen rather than merely assumed. */
export function quickLogSaved(action: QuickLogAction): string {
  switch (action.kind) {
    case "weigh":
      return `saved ✓ weigh-in ${action.kg} kg · ${dayHeading(action.day)}`;
    case "todo":
      return `saved ✓ captured · ${action.text}`;
    case "now":
      return `saved ✓ now · ${action.key} · ${clip(action.text)}`;
    case "cast":
      return `saved ✓ cast · ${clip(action.name)} · ${aud(action.stones / 100)} · ${dayHeading(action.day)}`;
    case "study":
      return `saved ✓ study · ${studyText(action)}`;
  }
}
