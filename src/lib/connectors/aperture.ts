import { normalizeApertureGlance, type ApertureGlance } from "@/lib/aperture";
import { getApertureGlanceRaw } from "@/lib/aperturestore";

/**
 * aperture connector — the render-side read of the plaintext status glance (rank,
 * stage, seal time). Deliberately UNCACHED, unlike the layout/steps connectors: the
 * command center is force-dynamic and the owner reads this band seconds after
 * running a sync, so any revalidate window would show a stale rank at exactly the
 * moment the number matters.
 *
 * There is NO sample/placeholder fallback here, and that is the whole design of
 * this file. Every other connector invents a plausible shape when the store is off
 * so the dashboard looks alive; fiction about a private status is worse than
 * silence — a made-up rank is a lie the owner would act on. So store off, absent,
 * a flaky read, unparseable JSON and a wrong frame all collapse to the one honest
 * null, and the band renders its "unplaced" line instead of a number.
 */
export async function getApertureGlance(): Promise<ApertureGlance | null> {
  try {
    const read = await getApertureGlanceRaw();
    if (read.state !== "ok") return null;
    try {
      const parsed: unknown = JSON.parse(read.value);
      return normalizeApertureGlance(parsed) ?? null;
    } catch {
      return null;
    }
  } catch (err) {
    console.error("[connector:aperture] read failed:", err);
    return null;
  }
}
