/**
 * now — the pure spine of the front door's "now" block: the handful of lines
 * that say what I am doing at the moment. The WORDS ARE DATA, never code (the
 * layout config's exact precedent): a line changes from the /system panel or
 * the ⌘K palette, not from a PR, because a "now" block that needs a deploy to
 * move stops being a now block within a fortnight.
 *
 * Deliberately PLAINTEXT (`meta/now.json`, see lib/nowstore): every word here is
 * rendered to any stranger who loads the lobby, so sealing it would protect
 * nothing. The WRITE stays owner-gated.
 *
 * Nothing here touches a store or a clock — the caller passes the moment in — so
 * the same config always normalizes, edits and labels the same way.
 */

/** One row of the block: a short left-hand key and the sentence beside it. */
export interface NowLine {
  key: string;
  text: string;
}

export interface NowConfig {
  v: 1;
  lines: NowLine[];
  /** When the block was last edited, ISO — the card's "updated …" stamp. */
  updatedAt: string;
}

/** Caps. The block is a front door, not a blog: eight short rows is already more
 *  than a visitor reads, and a line past 140 chars has stopped being a line. */
export const MAX_NOW_LINES = 8;
export const MAX_NOW_TEXT = 140;
export const MAX_NOW_KEY = 12;

/** Body cap for the PUT — eight short strings and a timestamp. */
export const NOW_MAX_BYTES = 4096;

/** What the lobby says before a single word has been edited — and what it falls
 *  back to whenever the store is off, absent, or unreadable. Real sentences, not
 *  placeholder text: the front door must never read as a half-built page. */
export const DEFAULT_NOW: NowConfig = {
  v: 1,
  lines: [
    {
      key: "open to",
      text: "a software engineering role in Sydney — hybrid or remote, starting now",
    },
    {
      key: "building",
      text: "anthonyta.dev, this hub · ishin, a tone translator for Japanese",
    },
    { key: "learning", text: "Japanese, toward a JLPT sitting in July" },
    { key: "reading", text: "webnovels — 《地狱十八层》 at the moment" },
  ],
  updatedAt: "2026-09-15T00:00:00+10:00",
};

/**
 * Strict parse: `null` on anything unrecognizable, which the route answers and
 * the connector falls back from.
 *
 * Over-cap is a HARD REJECT rather than a clamp — both writers (the panel's
 * `maxLength` inputs, the palette's parser) refuse an over-long line before it
 * is ever sent, so an over-cap blob means the JSON was edited by something that
 * isn't this app, and quietly trimming it to fit would publish words nobody
 * chose. An empty half, by contrast, is just a row the owner started and
 * abandoned: dropped, not fatal. Keys lowercase and dedupe keep-first so the
 * card's left column stays one column.
 */
export function normalizeNow(x: unknown): NowConfig | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.updatedAt !== "string") return null;
  if (!Number.isFinite(Date.parse(o.updatedAt))) return null;
  if (!Array.isArray(o.lines) || o.lines.length > MAX_NOW_LINES) return null;

  const lines: NowLine[] = [];
  const seen = new Set<string>();
  for (const raw of o.lines) {
    if (typeof raw !== "object" || raw === null) return null;
    const l = raw as Record<string, unknown>;
    if (typeof l.key !== "string" || typeof l.text !== "string") return null;
    const key = l.key.trim().toLowerCase();
    const text = l.text.trim();
    if (key.length > MAX_NOW_KEY || text.length > MAX_NOW_TEXT) return null;
    if (!key || !text) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ key, text });
  }
  return { v: 1, lines, updatedAt: o.updatedAt };
}

/** Trim + lowercase + clip one row's halves the way `normalizeNow` would. */
function clean(key: string, text: string): NowLine {
  return {
    key: key.trim().toLowerCase().slice(0, MAX_NOW_KEY),
    text: text.trim().slice(0, MAX_NOW_TEXT),
  };
}

/**
 * Write one line: replace the row with that key, or append it. Returns the
 * config UNCHANGED (the same object) when there is nothing to write — an empty
 * half, or a ninth row against a full block — so the caller can see the no-op
 * and say so rather than reporting a save that never happened.
 */
export function setLine(
  cfg: NowConfig,
  key: string,
  text: string,
  now: Date = new Date(),
): NowConfig {
  const line = clean(key, text);
  if (!line.key || !line.text) return cfg;
  const i = cfg.lines.findIndex((l) => l.key === line.key);
  if (i < 0 && cfg.lines.length >= MAX_NOW_LINES) return cfg;
  const lines =
    i >= 0
      ? cfg.lines.map((l, j) => (j === i ? line : l))
      : [...cfg.lines, line];
  return { ...cfg, lines, updatedAt: now.toISOString() };
}

/** Drop one line by key. Unchanged (the same object) when there is no such row. */
export function removeLine(
  cfg: NowConfig,
  key: string,
  now: Date = new Date(),
): NowConfig {
  const k = key.trim().toLowerCase();
  if (!cfg.lines.some((l) => l.key === k)) return cfg;
  return {
    ...cfg,
    lines: cfg.lines.filter((l) => l.key !== k),
    updatedAt: now.toISOString(),
  };
}

// en-CA formats as YYYY-MM-DD. Hoisted — Intl formatters are costly to build.
const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
});

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
]; // prettier-ignore

/**
 * The card's stamp — `"updated 15 sep 2026"`, reckoned on the SYDNEY day the
 * edit happened, since that is the day I would name if asked. The month word is
 * spelled here rather than by a locale so the label can't drift between the
 * server that renders it and the browser that reads it. `""` on an unparseable
 * stamp, so a bad timestamp shows nothing instead of "Invalid Date".
 */
export function updatedLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const [y, m, d] = SYDNEY_DAY.format(new Date(t)).split("-").map(Number);
  return `updated ${d} ${MONTHS[m - 1]} ${y}`;
}
