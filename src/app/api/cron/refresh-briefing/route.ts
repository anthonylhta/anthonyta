import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

/**
 * Pre-warms the briefing cache each morning so today's briefing is live before
 * anyone visits — instead of waiting for the lazy ISR window + a triggering hit.
 * Called by a Vercel Cron (vercel.json) at 22:30 UTC ≈ 8:30am AEST / 9:30am AEDT,
 * after the daily Drive doc is written (~8am Sydney). Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`; we require it when the secret is set.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  revalidatePath("/");
  revalidatePath("/briefing");
  return Response.json({
    revalidated: ["/", "/briefing"],
    at: new Date().toISOString(),
  });
}
