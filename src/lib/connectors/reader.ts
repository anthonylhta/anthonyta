import { unstable_cache } from "next/cache";
import {
  FEEDS,
  interleave,
  LANES,
  parseFeed,
  sampleLanes,
  type Feed,
  type FeedItem,
  type LaneRead,
} from "@/lib/reader";

/**
 * reader connector — fetch + parse every feed in the code-defined list
 * (roadmap 54), then fold them into the page's lanes. Each feed is independent
 * and fully guarded: a timeout, a non-2xx, or garbage XML just leaves that
 * feed out of its lane (logged). Only when EVERY feed fails does the page get
 * the labeled sample. Cached 30 min — feeds are a morning read, not a ticker.
 */

const FETCH_TIMEOUT_MS = 5000;

// Keep only a few items per feed before the lane is laid: the lane interleaves
// one row per source, so a feed's share is its turn, never its volume.
const PER_FEED = 5;

/** Rows a lane carries — six read at rest, the rest behind the fold. */
const LANE_DEPTH = 15;

// A descriptive User-Agent — several feeds 403/429 an unidentified client, and
// it's the polite way to identify the fetcher.
const USER_AGENT = "anthonyta.dev reader (+https://anthonyta.dev)";

async function fetchFeed(feed: Feed): Promise<FeedItem[]> {
  try {
    const res = await fetch(feed.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: "application/rss+xml, application/atom+xml, */*",
        "user-agent": USER_AGENT,
      },
    });
    if (!res.ok) {
      console.error("[connector:reader] http", res.status, feed.label);
      return [];
    }
    // The drop runs before the cap, so a release feed's canaries don't spend
    // its five rows; the language rides each row to the font it renders in.
    const items = parseFeed(await res.text(), feed.label, 50)
      .filter((i) => !(feed.drop && feed.drop.test(i.title)))
      .slice(0, PER_FEED);
    return feed.lang ? items.map((i) => ({ ...i, lang: feed.lang })) : items;
  } catch (err) {
    console.error("[connector:reader]", feed.label, "failed:", err);
    return [];
  }
}

export interface ReaderRead {
  sample: boolean;
  lanes: LaneRead[];
}

const load = unstable_cache(
  async (): Promise<ReaderRead> => {
    const lists = await Promise.all(FEEDS.map((f) => fetchFeed(f)));
    const lanes: LaneRead[] = LANES.map((lane) => {
      const own = FEEDS.map((f, i) => [f, lists[i]] as const).filter(
        ([f]) => f.lane === lane.key,
      );
      return {
        key: lane.key,
        label: lane.label,
        sources: own.map(([f]) => f.label),
        items: interleave(
          own.map(([, l]) => l),
          LANE_DEPTH,
        ),
      };
    });
    if (lanes.every((l) => l.items.length === 0))
      return { sample: true, lanes: sampleLanes() };
    return { sample: false, lanes };
  },
  ["reader"],
  { revalidate: 1800, tags: ["reader"] },
);

/** The lanes; total failure → labeled sample, never a crash. */
export async function getReaderItems(): Promise<ReaderRead> {
  try {
    return await load();
  } catch (err) {
    console.error("[connector:reader] read failed:", err);
    return { sample: true, lanes: sampleLanes() };
  }
}
