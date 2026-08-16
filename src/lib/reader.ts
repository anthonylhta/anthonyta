/**
 * reader — the pure spine of the /reader page (roadmap 54). A hand-rolled
 * RSS 2.0 / Atom item extractor in the TOTP tradition: own the primitive,
 * test it against realistic fixtures, take no dependency. It extracts ONLY
 * `{title, link, date, source}` — never the feeds' HTML bodies — so there is
 * no sanitization surface: titles render as React text, links are validated
 * http(s) before they're kept.
 *
 * The feed list lives IN CODE like the /novels list: the server must know
 * the URLs to fetch them (so the list can't be E2EE), and editing it is a
 * one-line PR.
 *
 * Curated to the owner's interests — tech, Japan, gaming, genre fiction — and
 * to what a server can actually fetch. The obvious hobby-specific sources are
 * RSS-hostile from a datacenter IP: Reddit (r/CompetitiveTFT, r/rational) 403s
 * then 429s any non-browser / cloud request, and Dot Esports / ScribbleHub sit
 * behind a Cloudflare bot challenge. So the two "closest reachable" stand-ins:
 * Dexerto for Riot/esports, Reactor (Tor) for serialized/genre fiction.
 */

export interface Feed {
  key: string;
  label: string;
  url: string;
}

export const FEEDS: Feed[] = [
  // tech / programming
  { key: "hn", label: "hn", url: "https://news.ycombinator.com/rss" },
  { key: "lobsters", label: "lobsters", url: "https://lobste.rs/rss" },
  // japan — anime + language
  {
    key: "ann",
    label: "anime news",
    url: "https://www.animenewsnetwork.com/all/rss.xml",
  },
  { key: "tofugu", label: "tofugu", url: "https://www.tofugu.com/feed.xml" },
  // gaming — riot / esports (TFT-specific feeds are all bot-blocked)
  { key: "dexerto", label: "dexerto", url: "https://www.dexerto.com/feed/" },
  // fiction — serialized / genre (web-serial sites have no server-fetchable feed)
  { key: "reactor", label: "reactor", url: "https://reactormag.com/feed/" },
];

export interface FeedItem {
  source: string;
  title: string;
  link: string;
  /** Epoch ms of the item's published/updated time; null when unparseable. */
  ts: number | null;
}

/** Numeric + the five named entities feeds actually use. Applied AFTER tag
 *  extraction, so a decoded `<` is just text to React, never markup. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `<title>…</title>` content with CDATA unwrapped; null when absent/empty. */
function tagText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!m) return null;
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return raw || null;
}

function httpLink(raw: string | null): string | null {
  if (!raw) return null;
  const url = decodeEntities(raw.trim());
  return /^https?:\/\//i.test(url) ? url : null;
}

/** The item's link: RSS `<link>text</link>`, Atom `<link href="…">` (prefer
 *  rel="alternate", fall back to the first href). */
function itemLink(block: string): string | null {
  const rssText = tagText(block, "link");
  if (rssText && !rssText.startsWith("<")) {
    const l = httpLink(rssText);
    if (l) return l;
  }
  const alternate =
    /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i.exec(block) ??
    /<link[^>]*href="([^"]+)"[^>]*rel="alternate"/i.exec(block);
  if (alternate) return httpLink(alternate[1]);
  const any = /<link[^>]*href="([^"]+)"/i.exec(block);
  return any ? httpLink(any[1]) : null;
}

function itemTs(block: string): number | null {
  const raw =
    tagText(block, "pubDate") ??
    tagText(block, "published") ??
    tagText(block, "updated") ??
    tagText(block, "dc:date");
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** Best-effort parse of one feed document (RSS 2.0 or Atom); anything
 *  malformed is dropped item-by-item — a degraded feed beats a crashed page. */
export function parseFeed(xml: string, source: string, limit = 20): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi)].map(
    (m) => m[2],
  );
  const out: FeedItem[] = [];
  for (const block of blocks) {
    if (out.length >= limit) break;
    const rawTitle = tagText(block, "title");
    const link = itemLink(block);
    if (!rawTitle || !link) continue;
    out.push({
      source,
      title: decodeEntities(rawTitle).slice(0, 300),
      link,
      ts: itemTs(block),
    });
  }
  return out;
}

/** Flatten + newest-first (undated items sink) + cap. */
export function mergeItems(lists: FeedItem[][], cap = 40): FeedItem[] {
  return lists
    .flat()
    .sort((a, b) => (b.ts ?? -Infinity) - (a.ts ?? -Infinity))
    .slice(0, cap);
}

/** "now" / "5m" / "3h" / "2d" — the reader row's age column. */
export function timeAgo(ts: number | null, now: number): string {
  if (ts === null) return "—";
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** What renders when every feed is unreachable. */
export const SAMPLE_ITEMS: FeedItem[] = [
  {
    source: "sample",
    title: "Feeds unreachable — this is placeholder data",
    link: "https://example.com",
    ts: null,
  },
];

/* --- "new since your last visit" (roadmap 54's per-device read-state) -------
 *
 * Read-state that never leaves the device: no store, no sync, no server memory
 * of what the owner has read. All the page needs is WHEN the last visit was, so
 * a single localStorage record carries two timestamps and every marker is
 * derived from them.
 */

/** Where a device remembers its visits. Plain localStorage, like the
 *  breakthrough memory: a display fact about this browser, nothing worth
 *  sealing — a cleared browser just loses one session's highlights. */
export const READER_VISIT_KEY = "reader-visit-v1";

/** How long one visit stays "the same visit". Reloading, or coming back from a
 *  tab you opened off the timeline, must not re-baseline and wipe the markers
 *  you were still working through. */
export const VISIT_SESSION_MS = 30 * 60_000;

export interface ReaderVisit {
  /** Start of the PREVIOUS session — the baseline "new" is judged against. */
  last: number;
  /** Start of this session. */
  current: number;
}

/**
 * The stored record + now → the record this visit runs on. Three cases, and the
 * first is the one worth stating: on a device with no memory there is no
 * previous visit to be new AGAINST, so the baseline is now — nothing already
 * published is marked, rather than the whole timeline lighting up as "new".
 */
export function rollVisit(
  stored: ReaderVisit | null,
  now: number,
): ReaderVisit {
  if (stored === null) return { last: now, current: now };
  // Still inside the same session — keep the baseline, so a reload within the
  // half hour shows the same highlights it did a minute ago.
  if (now - stored.current < VISIT_SESSION_MS) return stored;
  return { last: stored.current, current: now };
}

/**
 * The stored JSON → a record, or null for "no usable memory". Junk reads as
 * null and never throws: the record is whatever some previous build (or another
 * page on the origin) left behind, so it is untrusted input like any other.
 */
export function parseVisit(json: string | null): ReaderVisit | null {
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { last, current } = raw as { last?: unknown; current?: unknown };
  if (typeof last !== "number" || typeof current !== "number") return null;
  if (!Number.isFinite(last) || !Number.isFinite(current)) return null;
  if (last < 0 || current < 0) return null;
  // A baseline after the session it precedes is a record no roll could produce.
  if (last > current) return null;
  return { last, current };
}

/** Published since the baseline. An undated item is never new — the marker
 *  would be a guess, and the age column already says "—". */
export function isNew(item: FeedItem, visit: ReaderVisit): boolean {
  return item.ts !== null && item.ts > visit.last;
}
