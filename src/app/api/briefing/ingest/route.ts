import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { isBriefing, MAX_INGEST_BYTES } from "@/lib/briefing";
import { putStoredBriefing } from "@/lib/briefingstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Briefing ingest (roadmap item 35 Phase A — the Google exit's transport swap). The
 * external daily pipeline POSTs the briefing JSON here, bearer-authed, instead of writing
 * a Google Doc; we store it in the private R2 bucket and the connector reads it first
 * (Drive stays as the transitional fallback until the pipeline switches — see
 * connectors/briefing.ts).
 *
 * The whole surface hides behind the 404 wall (ADR 0022): a missing/wrong token, an
 * oversize body, or a wrong-shaped payload all answer "Not found" with NO detail — a
 * prober must not learn the route exists, and there is no validation oracle for an
 * unauthenticated-shaped surface. A caller holding the real secret is the owner's own
 * pipeline, which reads its own logs to debug.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return nf();

  try {
    // Size-cap BEFORE parsing (mirrors /api/fin/config): read the raw bytes, reject
    // anything over the cap, only then decode + JSON.parse + shape-check.
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_INGEST_BYTES) return nf();

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return nf();
    }
    if (!isBriefing(parsed)) return nf();

    if (!(await putStoredBriefing(parsed)))
      return new Response("Unavailable", { status: 503 });

    // One tag refresh warms every surface that reads the briefing (lobby, command
    // center, /briefing) — the same tag the pre-warm cron uses.
    revalidateTag("briefing", "max");
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[briefing/ingest] failed", err);
    return new Response("Unavailable", { status: 503 });
  }
}

/**
 * Bearer gate — MIRRORS lib/cron-auth's discipline (constant-time compare over
 * fixed-length SHA-256 digests, fail CLOSED), but NOT imported from it because two things
 * differ:
 *   - the refusal is the 404 wall (ADR 0022), not a 401 — this is a hidden owner surface;
 *   - otherwise identical: production with no `BRIEFING_INGEST_SECRET` set → refuse (fail
 *     closed); locally / in CI (no secret, not production) → allow, so the route stays
 *     runnable by hand.
 */
function authorized(req: Request): boolean {
  const secret = process.env.BRIEFING_INGEST_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const provided = req.headers.get("authorization") ?? "";
  return safeEqual(provided, `Bearer ${secret}`);
}

/** Constant-time string equality via fixed-length SHA-256 digests (length-blind). */
function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}
