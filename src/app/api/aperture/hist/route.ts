import { auth } from "@/auth";
import {
  APERTURE_HIST_PREFIX,
  apertureHistDay,
  apertureHistPath,
} from "@/lib/aevcontext";
import { r2Enabled, r2List, readKey } from "@/lib/r2";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated read of the archived seal history (`meta/aperture-hist/*`, ADR
 * 0116). Two askings, one route, the `/api/vault/raw` precedent:
 *
 *   - no query        → the listing, `{ v: 1, days: [...] }` newest-first — the
 *                       days that exist, nothing more; the record band plans its
 *                       fetches from this.
 *   - `?d=YYYY-MM-DD` → that day's sealed envelope, raw ciphertext bytes. The
 *                       server cannot decrypt these; the owner's browser opens
 *                       them under the dated key's own AAD.
 *
 * The day parameter is validated by ROUND-TRIPPING the aevcontext family
 * helpers — a `d` is legal exactly when the key it builds parses back to it —
 * so the route holds no second copy of the day shape to drift (the #119/#122
 * failure class). Anything else is the byte-identical 404 wall (ADR 0022).
 *
 * Past the auth gate, absent and error stay distinguishable: a day that was
 * never archived answers 404, a flaky store answers 503 — including the
 * listing, where `r2List` throwing IS the flake (an empty page from a dead
 * store must never read as "no history yet").
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const d = new URL(req.url).searchParams.get("d");

    if (d !== null) {
      if (apertureHistDay(apertureHistPath(d)) !== d) return nf();
      const read = await readKey(apertureHistPath(d));
      if (read.state === "error")
        return new Response("Unavailable", { status: 503 });
      if (read.state === "absent") return nf();
      return new Response(read.value as BodyInit, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    }

    if (!r2Enabled()) return new Response("Unavailable", { status: 503 });
    const days: string[] = [];
    try {
      let token: string | undefined;
      do {
        const page = await r2List(APERTURE_HIST_PREFIX, token);
        for (const o of page.objects) {
          const day = apertureHistDay(o.key);
          if (day !== null) days.push(day);
        }
        token = page.next;
      } while (token !== undefined);
    } catch {
      return new Response("Unavailable", { status: 503 });
    }
    days.sort((a, b) => b.localeCompare(a));
    return Response.json(
      { v: 1, days },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[aperture-hist] get failed", err);
    return nf();
  }
}
