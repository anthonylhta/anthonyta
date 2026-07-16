import { unstable_cache } from "next/cache";
import { EMPTY_LAYOUT, normalizeLayout, type LayoutConfig } from "@/lib/layout";
import { getLayoutRaw } from "@/lib/layoutstore";

/**
 * layout connector — the guarded render-side read of the owner's layout
 * config. Fully degrading: store off (CI, local dev), absent (first run), a
 * flaky read, or a malformed blob all collapse to "nothing hidden" — the
 * surfaces render complete rather than blank, because a broken config must
 * never take the public lobby down with it. Cached at the data layer; the
 * /api/layout PUT revalidates the tag so a save shows up immediately.
 */

const load = unstable_cache(
  async (): Promise<LayoutConfig> => {
    const read = await getLayoutRaw();
    if (read.state !== "ok") return EMPTY_LAYOUT;
    try {
      const parsed: unknown = JSON.parse(read.value);
      return normalizeLayout(parsed) ?? EMPTY_LAYOUT;
    } catch {
      return EMPTY_LAYOUT;
    }
  },
  ["layout"],
  { revalidate: 3600, tags: ["layout"] },
);

/** The current layout config; every failure path is the empty (all-visible) one. */
export async function getLayout(): Promise<LayoutConfig> {
  try {
    return await load();
  } catch (err) {
    console.error("[connector:layout] read failed:", err);
    return EMPTY_LAYOUT;
  }
}
