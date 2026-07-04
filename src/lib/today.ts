/**
 * today — turns one Obsidian daily note (titled YYYY-MM-DD) into the command
 * center's TODAY digest. PURE string→struct, no I/O, so it's unit-tested without
 * Drive (the vault connector feeds it `getTodayNote()`'s text). Deterministic —
 * no model — so the hub keeps its zero-token-cost invariant (ADR 0009/0012):
 * "summarised" here means the note's own structure extracted and laid out clean,
 * not prose compressed. (ADR 0049.)
 *
 * The shape it reads:
 *   ---
 *   summary: one-line TL;DR        ← headline (optional; hidden when absent)
 *   ---
 *   # Day planner                  ← the schedule/tasks spine
 *   - [x] 15:00 - 23:00 Work       ← checkbox = state; optional leading time/range
 *   # Journal                      ← free prose; first line shown muted
 *   got up around 12 …
 *
 * The note fills in over the day, so every field degrades gracefully: a morning
 * note is just an unchecked planner, the rest empty.
 */

export interface PlannerItem {
  done: boolean;
  /** "15:00–23:00" / "15:00" / null — a leading time or range, if written. */
  time: string | null;
  text: string;
}

export interface TodayDigest {
  summary: string | null;
  planner: PlannerItem[];
  doneCount: number;
  openCount: number;
  journalPreview: string;
}

// Heading aliases, lower-cased. The template uses "Day planner" / "Journal"; the
// extras keep parsing resilient if a heading gets renamed slightly.
const PLANNER_HEADINGS = new Set([
  "day planner",
  "planner",
  "plans",
  "schedule",
]);
const JOURNAL_HEADINGS = new Set(["journal", "log", "notes"]);

const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
// A leading "HH:MM" or "HH:MM - HH:MM" range, then the item text.
const LEADING_TIME = /^(\d{1,2}:\d{2})(?:\s*[-–—]\s*(\d{1,2}:\d{2}))?\s+(.*)$/;

interface Section {
  heading: string; // lower-cased
  lines: string[];
}

/** Peel a leading `---\n…\n---` block off the front. Returns its inner text + body. */
function splitFrontmatter(md: string): { fm: string | null; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: md };
  return { fm: m[1], body: md.slice(m[0].length) };
}

/** The `summary:` property from frontmatter, unquoted. null if there isn't one. */
function summaryFrom(fm: string | null): string | null {
  if (!fm) return null;
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^summary\s*:\s*(.+)$/i);
    if (m)
      return (
        m[1]
          .trim()
          .replace(/^["']|["']$/g, "")
          .trim() || null
      );
  }
  return null;
}

/**
 * Split the body into `# heading` sections; lines before the first heading drop.
 * A `#` line inside a ``` / ~~~ fence is content, not a heading — otherwise a
 * fenced comment splits the planner and silently drops the tasks after it.
 */
function sections(body: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  let fence: string | null = null; // the opening run, e.g. "```"
  for (const raw of body.split(/\r?\n/)) {
    const f = raw.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length)
        fence = null;
      cur?.lines.push(raw);
      continue;
    }
    const h = fence ? null : raw.match(/^#{1,6}\s+(.+?)\s*$/);
    if (h) {
      cur = { heading: h[1].trim().toLowerCase(), lines: [] };
      out.push(cur);
    } else if (cur) {
      cur.lines.push(raw);
    }
  }
  return out;
}

/** Checkbox items under the planner heading, each split into state + time + text. */
function plannerFrom(secs: Section[]): PlannerItem[] {
  const sec = secs.find((s) => PLANNER_HEADINGS.has(s.heading));
  if (!sec) return [];
  const items: PlannerItem[] = [];
  for (const line of sec.lines) {
    const m = line.match(CHECKBOX);
    if (!m) continue; // only checkboxes count, so the done/left tally stays honest
    const done = m[1] !== " ";
    let text = m[2].trim();
    let time: string | null = null;
    const t = text.match(LEADING_TIME);
    if (t) {
      time = t[2] ? `${t[1]}–${t[2]}` : t[1];
      text = t[3].trim();
    }
    if (text) items.push({ done, time, text });
  }
  return items;
}

/** First real prose line of the journal section, stripped of markdown. "" if none. */
function journalPreviewFrom(secs: Section[]): string {
  const sec = secs.find((s) => JOURNAL_HEADINGS.has(s.heading));
  for (const raw of sec?.lines ?? []) {
    const t = raw.trim();
    if (!t || /^#{1,6}\s/.test(t)) continue;
    const line = t
      .replace(/^[-*+]\s+/, "") // bullets
      .replace(/^\[[ xX]\]\s*/, "") // task checkboxes
      .replace(/^>\s?/, "") // quotes
      .replace(/!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1") // wikilinks/embeds
      .replace(/[*_`~]/g, "") // emphasis
      .trim();
    // Slice by code points — a UTF-16 slice can cut an emoji in half.
    if (line) return [...line].slice(0, 140).join("");
  }
  return "";
}

/** Parse one daily note's markdown into the TODAY digest. Empty-safe. */
export function parseDaily(md: string): TodayDigest {
  const { fm, body } = splitFrontmatter(md ?? "");
  const secs = sections(body);
  const planner = plannerFrom(secs);
  const doneCount = planner.filter((p) => p.done).length;
  return {
    summary: summaryFrom(fm),
    planner,
    doneCount,
    openCount: planner.length - doneCount,
    journalPreview: journalPreviewFrom(secs),
  };
}
