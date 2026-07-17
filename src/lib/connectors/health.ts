import { unstable_cache } from "next/cache";
import {
  HEALTH_TARGETS,
  classifyHealth,
  type HealthResult,
} from "@/lib/health";

/**
 * health connector — one capped GET per sibling project (roadmap 55). Each
 * probe is independent and fully guarded: a timeout, a non-2xx, or a thrown
 * fetch is that project reading "down", never an error surfacing on the
 * homepage. The probe cap keeps a dead target from stalling the command
 * center's render, and the 5-min cache means most loads pay nothing.
 */

const PROBE_TIMEOUT_MS = 2500;

async function probe(url: string): Promise<{ ok: boolean; ms: number | null }> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { ok: res.ok, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: null };
  }
}

const load = unstable_cache(
  async (): Promise<HealthResult[]> =>
    Promise.all(
      HEALTH_TARGETS.map(async (t) => {
        const { ok, ms } = await probe(t.url);
        return {
          key: t.key,
          label: t.label,
          state: classifyHealth(ok, ms),
          ms,
        };
      }),
    ),
  ["health"],
  { revalidate: 300, tags: ["health"] },
);

/** Current estate health; a total failure reads as every target down. */
export async function getHealth(): Promise<HealthResult[]> {
  try {
    return await load();
  } catch (err) {
    console.error("[connector:health] read failed:", err);
    return HEALTH_TARGETS.map((t) => ({
      key: t.key,
      label: t.label,
      state: "down",
      ms: null,
    }));
  }
}
