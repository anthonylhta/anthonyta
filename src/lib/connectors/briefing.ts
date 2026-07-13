import { unstable_cache } from "next/cache";
import { getStoredBriefing } from "@/lib/briefingstore";
import type { Briefing } from "@/lib/sampleBriefing";

/**
 * briefing connector — reads the daily markets briefing from the hub's own
 * store. The daily pipeline POSTs the briefing JSON to /api/briefing/ingest
 * (bearer-authed), which validates the shape, writes `meta/briefing/latest.json`,
 * and refreshes the tag; this just reads that object back. The Google Drive leg
 * (ADR 0009's transport — a service account reading a dated doc) is fully
 * retired: no third party carries the briefing anymore.
 *
 * READ-ONLY and fully guarded — store off (CI), nothing ingested yet, or any
 * failure returns `null` so every surface falls back to the sample.
 */

/**
 * Cached at the DATA layer (not the page) so every surface — the public lobby,
 * the command center, and `/briefing` — shares one store read and stays fast even
 * though they all render dynamically (each reads the session). Refreshed by the
 * ingest route via `revalidateTag("briefing")` the moment a new briefing lands.
 */
const loadBriefing = unstable_cache(
  async (): Promise<Briefing | null> => {
    const stored = await getStoredBriefing();
    return stored.state === "ok" ? stored.value : null;
  },
  ["briefing"],
  { revalidate: 600, tags: ["briefing"] },
);

export async function getBriefing(): Promise<Briefing | null> {
  try {
    return await loadBriefing();
  } catch (err) {
    console.error("[connector:briefing] failed", err);
    return null;
  }
}
