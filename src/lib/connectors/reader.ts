import { unstable_cache } from "next/cache";
import {
  FEEDS,
  SAMPLE_ITEMS,
  mergeItems,
  parseFeed,
  type FeedItem,
} from "@/lib/reader";

/**
 * reader connector — fetch + parse every feed in the code-defined list
 * (roadmap 54). Each feed is independent and fully guarded: a timeout, a
 * non-2xx, or garbage XML just leaves that feed out of the merge (logged).
 * Only when EVERY feed fails does the page get the labeled sample. Cached 30
 * min — feeds are a morning read, not a ticker.
 */

const FETCH_TIMEOUT_MS = 5000;

async function fetchFeed(url: string, label: string): Promise<FeedItem[]> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/rss+xml, application/atom+xml, */*" },
    });
    if (!res.ok) {
      console.error("[connector:reader] http", res.status, label);
      return [];
    }
    return parseFeed(await res.text(), label);
  } catch (err) {
    console.error("[connector:reader]", label, "failed:", err);
    return [];
  }
}

export interface ReaderRead {
  sample: boolean;
  items: FeedItem[];
}

const load = unstable_cache(
  async (): Promise<ReaderRead> => {
    const lists = await Promise.all(
      FEEDS.map((f) => fetchFeed(f.url, f.label)),
    );
    const items = mergeItems(lists);
    if (items.length === 0) return { sample: true, items: SAMPLE_ITEMS };
    return { sample: false, items };
  },
  ["reader"],
  { revalidate: 1800, tags: ["reader"] },
);

/** The merged timeline; total failure → labeled sample, never a crash. */
export async function getReaderItems(): Promise<ReaderRead> {
  try {
    return await load();
  } catch (err) {
    console.error("[connector:reader] read failed:", err);
    return { sample: true, items: SAMPLE_ITEMS };
  }
}
