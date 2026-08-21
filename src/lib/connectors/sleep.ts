import { unstable_cache } from "next/cache";
import { parseSleepStore, sampleSleep, type SleepData } from "@/lib/sleep";
import { getSleepRaw } from "@/lib/sleepstore";

/**
 * sleep connector — the nightly sleep history off the plaintext R2 store the phone
 * posts to. Guarded three ways, and the three-state matters:
 *  - store OFF (no R2 — local dev, CI) → a placeholder fortnight so the vessel
 *    looks alive;
 *  - store ABSENT (R2 on, nothing posted yet) → the honest empty state — no
 *    invented nights on the real reading;
 *  - store OK → the parsed history.
 * Cached 5 min at the data layer; the ingest fires `revalidateTag("sleep")` so a
 * fresh post lands immediately. `today` keys the cache so it rolls at date change
 * and seeds the placeholder relative to the current day.
 */
const load = unstable_cache(
  async (today: string): Promise<SleepData> => {
    try {
      const read = await getSleepRaw();
      if (read.state === "ok") return parseSleepStore(read.value);
      if (read.state === "absent") return { nights: {} };
      return sampleSleep(today); // store off / transport error
    } catch (err) {
      console.error("[connector:sleep] read failed:", err);
      return sampleSleep(today);
    }
  },
  ["sleep"],
  { revalidate: 300, tags: ["sleep"] },
);

/** The sleep history to render; every failure path falls back to the placeholder. */
export async function getSleep(today: string): Promise<SleepData> {
  try {
    return await load(today);
  } catch (err) {
    console.error("[connector:sleep] load failed:", err);
    return sampleSleep(today);
  }
}
