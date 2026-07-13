/**
 * relevance — match a day's markets briefing against the owner's holding codes,
 * entirely as a pure transform (roadmap item 35 Phase B). No I/O, no `next`, no
 * `react`, no Node-only APIs, so it runs in the client island that owns the actual
 * decrypted holdings and is unit-testable on its own (mirrors lib/today, lib/fin).
 *
 * The point of the split: the briefing lives server-side (public market news) and
 * the holdings live E2EE client-side; only the browser ever holds both, and this is
 * where they meet. The generator no longer needs any portfolio knowledge.
 */

import type { Briefing } from "./sampleBriefing";

/** One holding that showed up in the briefing, with every place it was mentioned. */
export interface RelevanceHit {
  code: string;
  /** `where` names the source (`"tape"`, `"bottom line"`, a section title, …);
   *  `text` is the matched line, code-point-truncated. At most one per source line. */
  hits: { where: string; text: string }[];
}

/** One scannable line of the briefing, tagged with its human source name. */
interface Source {
  where: string;
  text: string;
}

const TRUNCATE = 120;

/** Truncate to ~120 code points (never a UTF-16 slice — that can cut an emoji or
 *  any astral character in half; the codebase has a bug write-up on exactly that). */
function truncate(s: string): string {
  const cps = [...s];
  return cps.length <= TRUNCATE ? s : cps.slice(0, TRUNCATE).join("") + "…";
}

/** Maximal alphanumeric runs of a line — the candidate tokens to match against. */
function tokenize(text: string): string[] {
  return text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
}

/**
 * Token-boundary match, not substring, so "NVDA" never fires on "NVDAX". Codes of
 * length ≥ 3 match case-insensitively — so a holding coded "GOLD" catching the word
 * "Gold" is intended (the holding tracks the topic). Codes of length 1–2 match
 * case-sensitively as written (uppercase), so "AU" can't fire on the word "au".
 */
function matches(tokens: string[], code: string): boolean {
  if (code.length >= 3) {
    const u = code.toUpperCase();
    return tokens.some((t) => t.toUpperCase() === u);
  }
  return tokens.some((t) => t === code);
}

/** Every scannable line of the briefing, in a fixed source order. Skips the prose
 *  `portfolio` note (the thing this replaces) and the `sources` citations. */
function sourcesOf(b: Briefing): Source[] {
  return [
    { where: "driver", text: b.driver },
    { where: "summary", text: b.summary },
    ...b.tape.map((t) => ({ where: "tape", text: t.label })),
    ...b.bottomLine.map((line) => ({ where: "bottom line", text: line })),
    ...b.watch.map((w) => ({ where: "watch", text: w.label })),
    ...b.sections.flatMap((s) =>
      s.points.map((p) => ({ where: s.title, text: p })),
    ),
  ];
}

/**
 * The holdings that appear in today's briefing. Only codes with ≥ 1 hit are
 * returned, ordered by hit count descending then code ascending. Each source line
 * yields at most one hit per code (a code named twice in one line counts once), so
 * the count reads as "distinct lines mentioning it".
 */
export function matchBriefing(b: Briefing, codes: string[]): RelevanceHit[] {
  const sources = sourcesOf(b).map((s) => ({
    ...s,
    tokens: tokenize(s.text),
  }));

  const out: RelevanceHit[] = [];
  for (const code of [...new Set(codes)]) {
    if (!code) continue;
    const hits: RelevanceHit["hits"] = [];
    for (const s of sources) {
      if (matches(s.tokens, code)) {
        hits.push({ where: s.where, text: truncate(s.text) });
      }
    }
    if (hits.length > 0) out.push({ code, hits });
  }

  return out.sort(
    (a, b2) => b2.hits.length - a.hits.length || a.code.localeCompare(b2.code),
  );
}
