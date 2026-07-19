import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import {
  isStepsIngest,
  MAX_STEPS_BYTES,
  parseStepsStore,
  serializeStepsStore,
  upsertDay,
} from "@/lib/steps";
import { getStepsRaw, putSteps } from "@/lib/stepsstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/** Today in Sydney as YYYY-MM-DD — the store's day key (matches the TODAY zone). */
function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/**
 * Steps ingest — the phone's daily push (Samsung Health → Android Health Connect →
 * a daily automation POSTs `{ steps, date? }`). MIRRORS the briefing ingest (ADR
 * 0071): bearer-authed, fail-closed, and hidden behind the 404 wall (ADR 0022) —
 * a missing/wrong token, an oversize body, or a wrong-shaped payload all answer a
 * detail-free "Not found". A prober must not learn the route exists, and there is
 * no validation oracle for well-formed content; the owner's own automation reads
 * its own logs to debug.
 *
 * The step count is plaintext BY DESIGN (the owner's call): a low-sensitivity
 * number, closer to the weather than to net worth, so it rides a plain JSON blob
 * (meta/daily/steps.json) rather than the E2EE envelope. The phone is the single
 * writer, so the read-modify-write (upsert one day, prune history) is race-free.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return nf();

  try {
    // Size-cap BEFORE parsing (mirrors the briefing ingest): read the raw bytes,
    // reject anything over the cap, only then decode + JSON.parse + shape-check.
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_STEPS_BYTES) return nf();

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return nf();
    }
    if (!isStepsIngest(parsed)) return nf();

    const date = parsed.date ?? sydneyToday();

    // Read-modify-write: fold today's count into the retained history. A store
    // ERROR (not absent) means the current history can't be trusted — refuse
    // rather than clobber it back to a single day. "absent" is a genuine first run.
    const read = await getStepsRaw();
    if (read.state === "error")
      return new Response("Unavailable", { status: 503 });
    const current =
      read.state === "ok" ? parseStepsStore(read.value) : { days: {} };
    const next = upsertDay(current, date, parsed.steps);

    if (!(await putSteps(serializeStepsStore(next))))
      return new Response("Unavailable", { status: 503 });

    // Warm the command center's steps row immediately (same tag the connector reads).
    revalidateTag("steps", "max");
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[daily/steps] failed", err);
    return new Response("Unavailable", { status: 503 });
  }
}

/**
 * Bearer gate — MIRRORS the briefing ingest / lib/cron-auth discipline
 * (constant-time compare over fixed-length SHA-256 digests, fail CLOSED), but the
 * refusal is the 404 wall (ADR 0022), not a 401 — this is a hidden owner surface.
 * Production with no `STEPS_INGEST_SECRET` set → refuse; locally / in CI (no
 * secret, not production) → allow, so the route stays runnable by hand.
 */
function authorized(req: Request): boolean {
  const secret = process.env.STEPS_INGEST_SECRET;
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
