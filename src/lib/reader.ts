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
 * LANES, NOT A PILE (the 2026-09-15 relay): the page reads as four lanes the
 * owner named — craft, japan, sydney, the world — each a handful of sources
 * chosen for him rather than front pages, interleaved one row per source so a
 * firehose (Anime News Network posts a hundred a day) can never take a lane.
 * Everything here was probed through this parser before it entered the list
 * (the 2026-07-20 lesson: a datacenter IP is a different fetcher than a
 * laptop). What a server cannot fetch stays out: Reddit, the TFT sites, the
 * web-serial sites, and since September NHK Easy, whose list now sits behind a
 * token. Tofugu left because its newest post was three years old.
 *
 * What learns from the owner lives on the device, not the server: boost and
 * mute WORDS in localStorage beside the visit memory. A title carrying a boost
 * word floats to its lane's top; a muted one leaves the page with a count. No
 * model reads anything — the hub never calls one.
 */

import { MAX_TEXT } from "./todo";

export type LaneKey = "craft" | "japan" | "sydney" | "world";

export interface Lane {
  key: LaneKey;
  label: string;
}

/** The page's order. */
export const LANES: Lane[] = [
  { key: "craft", label: "craft" },
  { key: "japan", label: "japan" },
  { key: "sydney", label: "sydney" },
  { key: "world", label: "the world" },
];

export interface Feed {
  key: string;
  label: string;
  url: string;
  lane: LaneKey;
  /** Japanese-language source — its rows wear the JP font stack. */
  lang?: "ja";
  /** Titles to leave out at the source (a release feed's canaries). */
  drop?: RegExp;
}

export const FEEDS: Feed[] = [
  // craft — the best of HN rather than its front page; lobsters by tag
  { key: "hn", label: "hn", url: "https://hnrss.org/best", lane: "craft" },
  {
    key: "lobsters",
    label: "lobsters",
    url: "https://lobste.rs/t/ai,web,javascript.rss",
    lane: "craft",
  },
  {
    key: "simonw",
    label: "simon willison",
    url: "https://simonwillison.net/atom/everything/",
    lane: "craft",
  },
  {
    key: "nextjs",
    label: "next.js",
    url: "https://github.com/vercel/next.js/releases.atom",
    lane: "craft",
    drop: /canary|-rc\./i,
  },
  {
    key: "vercel",
    label: "vercel",
    url: "https://vercel.com/atom",
    lane: "craft",
  },
  // japan — easiest to hardest for the eye; the last two are the reading rungs
  {
    key: "ann",
    label: "anime news",
    url: "https://www.animenewsnetwork.com/all/rss.xml",
    lane: "japan",
  },
  {
    key: "soranews",
    label: "soranews",
    url: "https://soranews24.com/feed/",
    lane: "japan",
  },
  {
    key: "japantimes",
    label: "japan times",
    url: "https://www.japantimes.co.jp/feed/",
    lane: "japan",
  },
  {
    key: "joc",
    label: "just one cookbook",
    url: "https://www.justonecookbook.com/feed/",
    lane: "japan",
  },
  {
    key: "nhk",
    label: "nhk 日本語",
    url: "https://www.nhk.or.jp/rss/news/cat0.xml",
    lane: "japan",
    lang: "ja",
  },
  {
    key: "toyokeizai",
    label: "東洋経済",
    url: "https://toyokeizai.net/list/feed/rss",
    lane: "japan",
    lang: "ja",
  },
  // sydney — what the city is doing, and what happened in it
  {
    key: "concrete",
    label: "concrete playground",
    url: "https://concreteplayground.com/sydney/feed",
    lane: "sydney",
  },
  {
    key: "smh",
    label: "smh nsw",
    url: "https://www.smh.com.au/rss/national/nsw.xml",
    lane: "sydney",
  },
  {
    key: "abcsyd",
    label: "abc sydney",
    url: "https://www.abc.net.au/news/feed/2942460/rss.xml",
    lane: "sydney",
  },
  // the world
  {
    key: "abc",
    label: "abc",
    url: "https://www.abc.net.au/news/feed/45910/rss.xml",
    lane: "world",
  },
  {
    key: "guardian",
    label: "guardian au",
    url: "https://www.theguardian.com/au/rss",
    lane: "world",
  },
  {
    key: "bbc",
    label: "bbc world",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    lane: "world",
  },
];

export interface FeedItem {
  source: string;
  title: string;
  link: string;
  /** Epoch ms of the item's published/updated time; null when unparseable. */
  ts: number | null;
  /** Carried from the feed: a Japanese-language row wears the JP font stack. */
  lang?: "ja";
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

/**
 * One lane out of its sources' lists: round-robin, one row from each source
 * before a second from any, newest-first inside each source (undated sink).
 * The order is the promise — a source that posts a hundred a day gets exactly
 * the turns a source that posts one does — and the cap is the lane's depth.
 */
export function interleave(lists: FeedItem[][], cap = 15): FeedItem[] {
  const queues = lists.map((l) =>
    [...l].sort((a, b) => (b.ts ?? -Infinity) - (a.ts ?? -Infinity)),
  );
  const out: FeedItem[] = [];
  for (let round = 0; out.length < cap; round++) {
    let any = false;
    for (const q of queues) {
      if (out.length >= cap) break;
      const item = q[round];
      if (item) {
        out.push(item);
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
}

/** One lane as the page reads it — its sources, and its rows in reading order. */
export interface LaneRead {
  key: LaneKey;
  label: string;
  sources: string[];
  items: FeedItem[];
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

/** The sample as lanes — one row in the first lane, the rest empty. */
export function sampleLanes(): LaneRead[] {
  return LANES.map((l, i) => ({
    key: l.key,
    label: l.label,
    sources: ["sample"],
    items: i === 0 ? SAMPLE_ITEMS : [],
  }));
}

/* --- boost + mute words (the device's taste, never the server's) ----------- */

/** Where a device keeps its words. localStorage like the visit memory: a
 *  display preference for this browser, nothing worth sealing. */
export const READER_PREFS_KEY = "reader-prefs-v1";

export interface ReaderPrefs {
  boost: string[];
  mute: string[];
}

export const EMPTY_PREFS: ReaderPrefs = { boost: [], mute: [] };

/** Words per list and letters per word — a taste, not a filter language. */
export const MAX_WORDS = 20;
const MAX_WORD = 32;

/** "japanese, TypeScript  claude" → ["japanese", "typescript", "claude"]:
 *  split on commas and whitespace, lowercased, deduped, capped. */
export function parseWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\s]+/)) {
    const w = raw.trim().toLowerCase().slice(0, MAX_WORD);
    if (w && !out.includes(w)) out.push(w);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

/** The stored JSON → prefs, or the empty pair. Junk never throws — it is
 *  whatever a previous build left behind, untrusted like the visit record. */
export function parsePrefs(json: string | null): ReaderPrefs {
  if (json === null) return EMPTY_PREFS;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return EMPTY_PREFS;
  }
  if (typeof raw !== "object" || raw === null) return EMPTY_PREFS;
  const { boost, mute } = raw as { boost?: unknown; mute?: unknown };
  const words = (x: unknown) =>
    Array.isArray(x)
      ? parseWords(x.filter((w) => typeof w === "string").join(" "))
      : [];
  return { boost: words(boost), mute: words(mute) };
}

function hasWord(item: FeedItem, words: string[]): boolean {
  if (words.length === 0) return false;
  const t = item.title.toLowerCase();
  return words.some((w) => t.includes(w));
}

export function isBoosted(item: FeedItem, prefs: ReaderPrefs): boolean {
  return hasWord(item, prefs.boost);
}

export function isMuted(item: FeedItem, prefs: ReaderPrefs): boolean {
  return hasWord(item, prefs.mute);
}

/** A lane's rows under the device's words: muted rows leave (counted), boosted
 *  rows rise to the top in their existing order, the rest keep theirs. A mute
 *  wins over a boost — hiding is the stronger wish. */
export function rankLane(
  items: FeedItem[],
  prefs: ReaderPrefs,
): { shown: FeedItem[]; muted: number } {
  const kept = items.filter((i) => !isMuted(i, prefs));
  const shown = [
    ...kept.filter((i) => isBoosted(i, prefs)),
    ...kept.filter((i) => !isBoosted(i, prefs)),
  ];
  return { shown, muted: items.length - kept.length };
}

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

/* --- saving a headline (roadmap 54 → the capture list) ---------------------- */

/**
 * A headline as one capture line: `title — link`. Over the capture cap the
 * TITLE is what gives, never the link — a cut link is a dead capture, and the
 * whole point of saving the row is being able to open it later. (A link long
 * enough to blow the cap on its own would still be clipped by `addItem`; no
 * feed has ever come close.)
 */
export function captureText(title: string, link: string): string {
  const tail = ` — ${link}`;
  const room = MAX_TEXT - tail.length;
  if (title.length <= room) return `${title}${tail}`;
  return `${title.slice(0, Math.max(0, room - 1))}…${tail}`;
}
