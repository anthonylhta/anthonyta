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

/**
 * What an index ETF is ABOUT, because a briefing never says the ticker: prose
 * talks "Nasdaq", "ASX 200", "Hang Seng" — vocabulary a token-matched code can
 * never reach, which left the relevance section blank almost every day for an
 * index-ETF portfolio. Each entry maps a code to the topic phrases whose
 * appearance in a line means that line concerns the holding.
 *
 * DELIBERATELY GENERIC, and that is a privacy constraint, not padding: this
 * table lives in a public repo, so it enumerates COMMON ASX/US-listed ETFs —
 * public knowledge of what each fund tracks — never one person's portfolio.
 * Which rows matter is decided in the browser, after the holdings decrypt.
 *
 * Phrases err specific over broad ("ASX 200", never bare "ASX") so a holding
 * doesn't light up on every line that names the exchange.
 */
const ETF_TOPICS: Record<string, readonly string[]> = {
  // Nasdaq-100 trackers
  NDQ: ["Nasdaq"],
  HNDQ: ["Nasdaq"],
  QQQ: ["Nasdaq"],
  // S&P 500 trackers
  IVV: ["S&P 500"],
  SPY: ["S&P 500"],
  VOO: ["S&P 500"],
  IHVV: ["S&P 500"],
  // broad developed-world (majority-US, so Wall Street lines concern them)
  VGS: ["MSCI World", "S&P 500", "Wall Street"],
  BGBL: ["MSCI World", "S&P 500", "Wall Street"],
  IWLD: ["MSCI World", "S&P 500", "Wall Street"],
  HGBL: ["MSCI World", "S&P 500", "Wall Street"],
  VTS: ["Wall Street", "S&P 500"],
  // Australian equity
  IOZ: ["ASX 200"],
  A200: ["ASX 200"],
  STW: ["ASX 200"],
  VAS: ["ASX 300", "ASX 200"],
  VHY: ["ASX 200"],
  // emerging markets / Asia
  VGE: ["emerging markets", "Hang Seng"],
  IEM: ["emerging markets", "Hang Seng"],
  VAE: ["Hang Seng", "Nikkei"],
  IAA: ["Hang Seng", "Nikkei"],
  // fixed income — moved by rates, so yield/RBA lines concern them
  VAF: ["bond", "yields", "RBA"],
  VGB: ["bond", "yields", "RBA"],
  IAF: ["bond", "yields", "RBA"],
  VBND: ["bond", "yields"],
  // commodities
  GOLD: ["gold"],
  QAU: ["gold"],
  // crypto trackers
  VBTC: ["Bitcoin", "BTC"],
  EBTC: ["Bitcoin", "BTC"],
};

/**
 * A topic phrase matches when its token sequence appears contiguously in the
 * line's tokens, case-insensitively — "S&P 500" tokenizes to S·P·500 and finds
 * the same run in "S&P 500 futures", but "ASX 200" never fires on plain "ASX".
 * Case-insensitive even for short tokens: inside a phrase the neighbours
 * disambiguate, which is the ambiguity the bare-code rule guards against.
 */
function phraseMatches(tokens: string[], phrase: string): boolean {
  const want = tokenize(phrase).map((t) => t.toUpperCase());
  if (want.length === 0) return false;
  const have = tokens.map((t) => t.toUpperCase());
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((w, j) => have[i + j] === w)) return true;
  }
  return false;
}

/** A line concerns a holding when it names the code itself (a briefing might
 *  literally say "NDQ") or any of the code's topic phrases. */
function concernsHolding(tokens: string[], code: string): boolean {
  if (matches(tokens, code)) return true;
  const topics = ETF_TOPICS[code.toUpperCase()];
  return topics !== undefined && topics.some((p) => phraseMatches(tokens, p));
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
      if (concernsHolding(s.tokens, code)) {
        hits.push({ where: s.where, text: truncate(s.text) });
      }
    }
    if (hits.length > 0) out.push({ code, hits });
  }

  return out.sort(
    (a, b2) => b2.hits.length - a.hits.length || a.code.localeCompare(b2.code),
  );
}
