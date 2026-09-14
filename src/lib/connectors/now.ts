import { unstable_cache } from "next/cache";
import { DEFAULT_NOW, normalizeNow, type NowConfig } from "@/lib/now";
import { getNowRaw } from "@/lib/nowstore";

/**
 * now connector — the guarded render-side read of the front door's "now" block.
 * Fully degrading: store off (CI, local dev), absent (first run), a flaky read,
 * or a malformed blob all collapse to `DEFAULT_NOW` — the card always has real
 * sentences in it, because a broken config must never take the public lobby's
 * first paragraph down with it. Cached at the data layer; the /api/now PUT
 * revalidates the tag so an edit shows up immediately.
 */

const load = unstable_cache(
  async (): Promise<NowConfig> => {
    const read = await getNowRaw();
    if (read.state !== "ok") return DEFAULT_NOW;
    try {
      const parsed: unknown = JSON.parse(read.value);
      return normalizeNow(parsed) ?? DEFAULT_NOW;
    } catch {
      return DEFAULT_NOW;
    }
  },
  ["now"],
  { revalidate: 3600, tags: ["now"] },
);

/** The current now block; every failure path is the default one. */
export async function getNow(): Promise<NowConfig> {
  try {
    return await load();
  } catch (err) {
    console.error("[connector:now] read failed:", err);
    return DEFAULT_NOW;
  }
}
