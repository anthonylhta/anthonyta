import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  isNew,
  mergeItems,
  parseFeed,
  parseVisit,
  rollVisit,
  timeAgo,
  VISIT_SESSION_MS,
  type FeedItem,
  type ReaderVisit,
} from "./reader";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example</title>
  <link>https://example.com</link>
  <item>
    <title><![CDATA[Rust 2.0 released & it's fast]]></title>
    <link>https://example.com/rust-2</link>
    <pubDate>Thu, 17 Jul 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Plain &amp; simple &#8212; entities decode</title>
    <link>https://example.com/entities</link>
    <pubDate>Thu, 17 Jul 2026 07:00:00 GMT</pubDate>
  </item>
  <item>
    <title>No link — dropped</title>
  </item>
  <item>
    <title>Bad scheme — dropped</title>
    <link>javascript:alert(1)</link>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <link href="https://example.org/"/>
  <entry>
    <title>Atom entry one</title>
    <link rel="alternate" href="https://example.org/one"/>
    <updated>2026-07-17T06:30:00Z</updated>
  </entry>
  <entry>
    <title>Atom entry two</title>
    <link href="https://example.org/two"/>
    <published>2026-07-16T20:00:00Z</published>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS items — CDATA, entities, dates", () => {
    const items = parseFeed(RSS, "example");
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      source: "example",
      title: "Rust 2.0 released & it's fast",
      link: "https://example.com/rust-2",
      ts: Date.parse("Thu, 17 Jul 2026 08:00:00 GMT"),
    });
    expect(items[1].title).toBe("Plain & simple — entities decode");
  });

  it("drops items without a title or a valid http(s) link", () => {
    const titles = parseFeed(RSS, "x").map((i) => i.title);
    expect(titles).not.toContain("No link — dropped");
    expect(titles).not.toContain("Bad scheme — dropped");
  });

  it("parses Atom entries — href links, updated/published dates", () => {
    const items = parseFeed(ATOM, "atom");
    expect(items).toHaveLength(2);
    expect(items[0].link).toBe("https://example.org/one");
    expect(items[0].ts).toBe(Date.parse("2026-07-17T06:30:00Z"));
    expect(items[1].link).toBe("https://example.org/two");
  });

  it("respects the per-feed limit and survives garbage", () => {
    expect(parseFeed(RSS, "x", 1)).toHaveLength(1);
    expect(parseFeed("not xml at all", "x")).toEqual([]);
    expect(parseFeed("", "x")).toEqual([]);
  });
});

describe("decodeEntities", () => {
  it("handles named, decimal and hex entities", () => {
    expect(
      decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;"),
    ).toBe("a & b <c> \"d\" 'e'");
    expect(decodeEntities("dash &#8212; and &#x2014;")).toBe("dash — and —");
  });
});

describe("mergeItems", () => {
  const item = (source: string, ts: number | null): FeedItem => ({
    source,
    title: "t",
    link: "https://x.com",
    ts,
  });

  it("interleaves newest-first, sinks undated, caps", () => {
    const merged = mergeItems(
      [
        [item("a", 100), item("a", 50)],
        [item("b", 75), item("b", null)],
      ],
      3,
    );
    expect(merged.map((i) => [i.source, i.ts])).toEqual([
      ["a", 100],
      ["b", 75],
      ["a", 50],
    ]);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-07-17T09:00:00Z");
  it("bands into now/m/h/d", () => {
    expect(timeAgo(now - 30_000, now)).toBe("now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d");
    expect(timeAgo(null, now)).toBe("—");
  });
});

describe("rollVisit", () => {
  const now = Date.parse("2026-08-16T09:00:00Z");

  it("baselines a first visit at now — nothing is new yet", () => {
    expect(rollVisit(null, now)).toEqual({ last: now, current: now });
  });

  it("keeps the baseline for a reload inside the session window", () => {
    const stored: ReaderVisit = {
      last: now - 86_400_000,
      current: now - 60_000,
    };
    expect(rollVisit(stored, now)).toEqual(stored);
    expect(rollVisit(stored, stored.current + VISIT_SESSION_MS - 1)).toEqual(
      stored,
    );
  });

  it("rolls the old session start into the baseline on a new visit", () => {
    const stored: ReaderVisit = {
      last: now - 86_400_000,
      current: now - 3_600_000,
    };
    expect(rollVisit(stored, now)).toEqual({
      last: stored.current,
      current: now,
    });
    expect(rollVisit(stored, stored.current + VISIT_SESSION_MS)).toEqual({
      last: stored.current,
      current: stored.current + VISIT_SESSION_MS,
    });
  });
});

describe("parseVisit", () => {
  it("accepts a well-formed record", () => {
    expect(parseVisit('{"last":100,"current":200}')).toEqual({
      last: 100,
      current: 200,
    });
  });

  it("rejects junk, wrong shapes, negatives and inverted pairs", () => {
    expect(parseVisit(null)).toBeNull();
    expect(parseVisit("not json")).toBeNull();
    expect(parseVisit("null")).toBeNull();
    expect(parseVisit('"200"')).toBeNull();
    expect(parseVisit("{}")).toBeNull();
    expect(parseVisit('{"last":"100","current":200}')).toBeNull();
    expect(parseVisit('{"last":100}')).toBeNull();
    expect(parseVisit('{"last":null,"current":200}')).toBeNull();
    expect(parseVisit('{"last":-1,"current":200}')).toBeNull();
    expect(parseVisit('{"last":300,"current":200}')).toBeNull();
  });
});

describe("isNew", () => {
  const item = (ts: number | null): FeedItem => ({
    source: "a",
    title: "t",
    link: "https://x.com",
    ts,
  });
  const visit: ReaderVisit = { last: 100, current: 200 };

  it("marks only items published after the baseline", () => {
    expect(isNew(item(101), visit)).toBe(true);
    expect(isNew(item(100), visit)).toBe(false);
    expect(isNew(item(99), visit)).toBe(false);
  });

  it("never marks an undated item", () => {
    expect(isNew(item(null), visit)).toBe(false);
  });

  it("marks nothing on a first visit, where the baseline is now", () => {
    const now = Date.parse("2026-08-16T09:00:00Z");
    const first = rollVisit(null, now);
    expect(isNew(item(now - 1000), first)).toBe(false);
    expect(isNew(item(now), first)).toBe(false);
  });
});
