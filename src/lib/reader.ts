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
 * one-line PR. This is a starter set — swap freely.
 */

export interface Feed {
  key: string;
  label: string;
  url: string;
}

export const FEEDS: Feed[] = [
  { key: "hn", label: "hn", url: "https://news.ycombinator.com/rss" },
  {
    key: "ars",
    label: "ars",
    url: "https://feeds.arstechnica.com/arstechnica/index",
  },
  {
    key: "guardian",
    label: "guardian au",
    url: "https://www.theguardian.com/au/rss",
  },
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
