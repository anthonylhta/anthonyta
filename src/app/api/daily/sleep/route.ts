import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import {
  isSleepIngest,
  MAX_SLEEP_BYTES,
  parseSleepStore,
  serializeSleepStore,
  upsertNight,
} from "@/lib/sleep";
import { getSleepRaw, putSleep } from "@/lib/sleepstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/** Today in Sydney as YYYY-MM-DD — the store's night key (the day the owner woke). */
function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/**
 * Sleep ingest — the phone's nightly push (a daily automation POSTs
 * `{ minutes, date? }`). MIRRORS the steps ingest (ADR 0101), which mirrors the
 * briefing one (ADR 0071): bearer-authed, fail-closed, and hidden behind the 404
 * wall (ADR 0022) — a missing/wrong token, an oversize body, or a wrong-shaped
 * payload all answer a detail-free "Not found". A prober must not learn the route
 * exists, and there is no validation oracle for well-formed content; the owner's
 * own automation reads its own logs to debug.
 *
 * The night's duration is plaintext BY DESIGN, the same call the step count rides:
 * a low-sensitivity number, closer to the weather than to net worth, so it lives in
 * a plain JSON blob (meta/daily/sleep.json) rather than the E2EE envelope. The
 * phone is the single writer, so the read-modify-write (upsert one night, prune
 * history) is race-free.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return nf();

  try {
    // Size-cap BEFORE parsing (mirrors the steps ingest): read the raw bytes,
    // reject anything over the cap, only then decode + JSON.parse + shape-check.
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_SLEEP_BYTES) return nf();

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return nf();
    }
    if (!isSleepIngest(parsed)) return nf();

    const date = parsed.date ?? sydneyToday();

    // Read-modify-write: fold last night's minutes into the retained history. A
    // store ERROR (not absent) means the current history can't be trusted — refuse
    // rather than clobber it back to a single night. "absent" is a genuine first run.
    const read = await getSleepRaw();
    if (read.state === "error")
      return new Response("Unavailable", { status: 503 });
    const current =
      read.state === "ok" ? parseSleepStore(read.value) : { nights: {} };
    const next = upsertNight(current, date, parsed.minutes);

    if (!(await putSleep(serializeSleepStore(next))))
      return new Response("Unavailable", { status: 503 });

    // Warm the vessel's sleep figure immediately (same tag the connector reads).
    revalidateTag("sleep", "max");
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[daily/sleep] failed", err);
    return new Response("Unavailable", { status: 503 });
  }
}

/**
 * Bearer gate — MIRRORS the steps ingest exactly, and DELIBERATELY reuses its
 * secret: the same phone, on the same nightly automation, in the same trust
 * domain, pushing the same class of low-sensitivity body reading. A second secret
 * would be a second thing to mint, set, and rotate for no gain in isolation —
 * whoever holds `STEPS_INGEST_SECRET` already holds the device that measures both.
 *
 * Constant-time compare over fixed-length SHA-256 digests, fail CLOSED, and the
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
