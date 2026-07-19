import { unstable_cache } from "next/cache";
import { parseStepsStore, sampleSteps, type StepsData } from "@/lib/steps";
import { getStepsRaw } from "@/lib/stepsstore";

/**
 * steps connector — the daily step history off the plaintext R2 store the phone
 * posts to (Samsung Health → Health Connect → a daily automation). Guarded three
 * ways, and the three-state matters:
 *  - store OFF (no R2 — local dev, CI) → a placeholder fortnight so the dashboard
 *    looks alive;
 *  - store ABSENT (R2 on, nothing posted yet) → the honest empty state — no fake
 *    counts on the real dashboard;
 *  - store OK → the parsed history.
 * Cached 5 min at the data layer; the ingest fires `revalidateTag("steps")` so a
 * fresh post lands immediately. `today` keys the cache so it rolls at date change
 * and seeds the placeholder relative to the current day.
 */
const load = unstable_cache(
  async (today: string): Promise<StepsData> => {
    try {
      const read = await getStepsRaw();
      if (read.state === "ok") return parseStepsStore(read.value);
      if (read.state === "absent") return { days: {} };
      return sampleSteps(today); // store off / transport error
    } catch (err) {
      console.error("[connector:steps] read failed:", err);
      return sampleSteps(today);
    }
  },
  ["steps"],
  { revalidate: 300, tags: ["steps"] },
);

/** The step history to render; every failure path falls back to the placeholder. */
export async function getSteps(today: string): Promise<StepsData> {
  try {
    return await load(today);
  } catch (err) {
    console.error("[connector:steps] load failed:", err);
    return sampleSteps(today);
  }
}
