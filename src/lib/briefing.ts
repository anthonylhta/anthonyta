import type { Briefing, TapeItem } from "@/lib/sampleBriefing";

/**
 * Pure shape guard + caps for the daily markets briefing (roadmap item 35 Phase A —
 * the Google exit's transport swap). No `next`, store, or Node-only import, so it is
 * unit-testable on its own and safe to reuse anywhere (mirrors lib/dropbox).
 *
 * WHY a full guard: the briefing now arrives over an AUTHENTICATED-BUT-EXTERNAL write
 * path — the daily pipeline POSTs it to /api/briefing/ingest and the hub STORES what it
 * accepts, then the lobby, the command center, and /briefing all render it. A malformed
 * or hostile payload must not be able to park junk in the store that every page then
 * renders. The route's 256KB byte cap (`MAX_INGEST_BYTES`) is the TOTAL size bound; the
 * per-field caps below keep the shape sane and finite even within that budget.
 */

/** The ingest route's pre-parse body cap — the total-size bound (per-field caps are secondary). */
export const MAX_INGEST_BYTES = 256 * 1024;

// Generous-but-finite per-field caps. Prose fields (summary, bullet points, the
// portfolio note) run a sentence or two; labels / values / dates / urls are short.
export const MAX_TEXT = 4000;
export const MAX_LABEL = 500;
// Array-length caps — a valid-SHAPED but huge payload still can't balloon a render.
export const MAX_TAPE = 64;
export const MAX_LIST = 64;

function isText(x: unknown): x is string {
  return typeof x === "string" && x.length <= MAX_TEXT;
}

function isLabel(x: unknown): x is string {
  return typeof x === "string" && x.length <= MAX_LABEL;
}

function isTapeItem(x: unknown): x is TapeItem {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    isLabel(t.label) &&
    isLabel(t.value) &&
    (t.move === undefined || typeof t.move === "number")
  );
}

function isWatch(x: unknown): x is { date: string; label: string } {
  if (typeof x !== "object" || x === null) return false;
  const w = x as Record<string, unknown>;
  return isLabel(w.date) && isLabel(w.label);
}

function isSection(x: unknown): x is { title: string; points: string[] } {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    isLabel(s.title) &&
    Array.isArray(s.points) &&
    s.points.length <= MAX_LIST &&
    s.points.every(isText)
  );
}

function isSource(x: unknown): x is { label: string; url: string } {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return isLabel(s.label) && isLabel(s.url);
}

/** Strict guard for the whole Briefing shape — the sample briefing must pass. */
export function isBriefing(x: unknown): x is Briefing {
  if (typeof x !== "object" || x === null) return false;
  const b = x as Record<string, unknown>;
  return (
    isLabel(b.date) &&
    isLabel(b.weekday) &&
    isLabel(b.generated) &&
    isLabel(b.driver) &&
    isText(b.summary) &&
    Array.isArray(b.tape) &&
    b.tape.length <= MAX_TAPE &&
    b.tape.every(isTapeItem) &&
    Array.isArray(b.bottomLine) &&
    b.bottomLine.length <= MAX_LIST &&
    b.bottomLine.every(isText) &&
    Array.isArray(b.watch) &&
    b.watch.length <= MAX_LIST &&
    b.watch.every(isWatch) &&
    Array.isArray(b.sections) &&
    b.sections.length <= MAX_LIST &&
    b.sections.every(isSection) &&
    (b.portfolio === undefined || isText(b.portfolio)) &&
    (b.sources === undefined ||
      (Array.isArray(b.sources) &&
        b.sources.length <= MAX_LIST &&
        b.sources.every(isSource)))
  );
}
