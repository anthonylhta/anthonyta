import { unstable_cache } from "next/cache";
import {
  normalizeOpenMeteo,
  openMeteoParams,
  sampleWeather,
  type Weather,
} from "@/lib/weather";

/**
 * weather connector — Sydney current conditions off Open-Meteo (roadmap 51).
 * The one connector with no env var: the API is keyless, so the guarded →
 * sample fallback only ever covers an upstream failure, never a missing
 * secret. Cached 15 min at the data layer (~100 calls/day — Open-Meteo's
 * free tier allows 10k).
 */

const load = unstable_cache(
  async (): Promise<Weather> => {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?${openMeteoParams()}`,
      );
      if (!res.ok) {
        console.error("[connector:weather] http", res.status);
        return sampleWeather;
      }
      return normalizeOpenMeteo(await res.json()) ?? sampleWeather;
    } catch (err) {
      console.error("[connector:weather] fetch failed:", err);
      return sampleWeather;
    }
  },
  ["weather"],
  { revalidate: 900, tags: ["weather"] },
);

/** Sydney weather now; every failure path is the sample. */
export async function getWeather(): Promise<Weather> {
  try {
    return await load();
  } catch (err) {
    console.error("[connector:weather] read failed:", err);
    return sampleWeather;
  }
}
