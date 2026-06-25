import { revalidateTag } from "next/cache";
import { getBriefing } from "@/lib/connectors/briefing";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Pre-warms the briefing cache each morning so today's briefing is live before
 * anyone visits — instead of waiting for the lazy revalidate window + a triggering
 * hit. Called by a Vercel Cron (vercel.json) at 22:30 UTC ≈ 8:30am AEST / 9:30am
 * AEDT, after the daily Drive doc is written (~8am Sydney). Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`; we require it, fail-closed in production
 * (see lib/cron-auth).
 *
 * The briefing is cached at the data layer (`unstable_cache` tag "briefing"), so
 * one tag refresh warms every surface that reads it — the lobby, the command
 * center, and `/briefing`. (The old `revalidatePath("/")` was already a no-op once
 * `/` became dynamic by reading the session.)
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  // Mark the cached briefing stale, then pull today's doc so the cache holds it
  // before the first visitor arrives (rather than serving them a stale read).
  revalidateTag("briefing", "max");
  await getBriefing();
  return Response.json({
    revalidated: ["briefing"],
    at: new Date().toISOString(),
  });
}
