import { getPortfolio } from "@/lib/connectors/portfolio";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { authorizeCron } from "@/lib/cron-auth";
import { boxSeal, fromB64url, isSnapkey } from "@/lib/crypto";
import {
  isSnapIndex,
  sydneyToday,
  upsertIndexDay,
  type SnapBoxPayload,
  type SnapIndex,
} from "@/lib/fin";
import {
  getSnapIndex,
  getSnapkey,
  putSnapIndex,
  writeSnapBox,
} from "@/lib/finstore";
import { sweepExpiredShares } from "@/lib/shares";

export const dynamic = "force-dynamic";

/**
 * Nightly snapshot cron (E2EE net worth, ADR: sealed net worth) — writes history it
 * can never read. The cron holds ONLY the owner's static PUBLIC key; each night it
 * seals the day's invested figure into an anonymous box (`boxSeal`, ephemeral-static
 * ECDH → AES-GCM) that opens solely behind the passphrase. The server stores the
 * ciphertext and stays blind to it; cash/HISA are absent from the box BY DESIGN — the
 * server never learns them, so a snapshot it writes reveals nothing if the store leaks.
 *
 * Three independent outcomes, none able to sink another:
 * - `box`   — the sealed invested figure. Needs a LIVE portfolio (a sample-fallback
 *             `null` is skipped, never sealed) and the owner's snapkey to seal to
 *             (absent → history not enabled yet → skipped; a store flake → failed, no
 *             write).
 * - `index` — the plaintext reading-day count (no secret, so it rides unsealed as the
 *             week-over-week baseline). A read-modify-write over ~400 days of history,
 *             so a flaky read is `failed`, NEVER mistaken for absent — overwriting the
 *             index off a transient error would erase the record (the keystore lesson).
 * - `swept` — the count of expired fragment-key share envelopes reaped (ADR 0058).
 *             It piggybacks on this already-authorized nightly run; `sweepExpiredShares`
 *             never throws, but a defensive `catch → -1` keeps a sweep hiccup from
 *             sinking the snapshot.
 *
 * Runs late each Sydney evening via Vercel Cron (vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; required, fail-closed in production
 * (lib/cron-auth). The finstore is guarded, so a store that's off no-ops cleanly.
 */

type Outcome = "written" | "skipped" | "failed";

/** Seal the invested figure to the owner's public key and store the box. */
async function sealBox(
  portfolio: Awaited<ReturnType<typeof getPortfolio>>,
  snapkey: Awaited<ReturnType<typeof getSnapkey>>,
  date: string,
): Promise<Outcome> {
  // Sample fallback / Drive off (null) — a demo figure would poison the trend.
  if (!portfolio) return "skipped";
  // Owner hasn't enabled history yet — normal, not an error.
  if (snapkey.state === "absent") return "skipped";
  // Store flake — do NOT seal to a key we couldn't read.
  if (snapkey.state === "error") return "failed";

  let box: Uint8Array;
  try {
    const parsed: unknown = JSON.parse(snapkey.value);
    if (!isSnapkey(parsed)) throw new Error("snapkey: unrecognized shape");
    const payload: SnapBoxPayload = {
      v: 1,
      date,
      investedCents: Math.round(portfolio.totals.value * 100),
    };
    box = await boxSeal(
      fromB64url(parsed.pub_b64),
      new TextEncoder().encode(JSON.stringify(payload)),
    );
  } catch (err) {
    console.error("[cron:snapshot] seal failed:", err);
    return "failed";
  }
  return (await writeSnapBox(date, box)) ? "written" : "failed";
}

/** Merge today's reading count into the plaintext index (read-modify-write). */
async function writeIndex(
  reading: Awaited<ReturnType<typeof getCurrentlyReading>>,
  snapIndex: Awaited<ReturnType<typeof getSnapIndex>>,
  date: string,
): Promise<Outcome> {
  // Guarded connector fallback (`[]`) — a forced 0 would poison the weekly delta.
  if (reading.length === 0) return "skipped";
  const readingChapters = reading.reduce((sum, r) => sum + r.chapter, 0);

  // A flaky read must NEVER read as absent: this rewrites the whole history, so an
  // error-as-empty would clobber ~400 days of days with a single fresh entry.
  if (snapIndex.state === "error") return "failed";

  let index: SnapIndex;
  if (snapIndex.state === "absent") {
    index = { v: 1, days: [] };
  } else {
    try {
      const parsed: unknown = JSON.parse(snapIndex.value);
      if (!isSnapIndex(parsed)) throw new Error("index: unrecognized shape");
      index = parsed;
    } catch (err) {
      // Don't overwrite something we can't recognize.
      console.error("[cron:snapshot] index parse failed:", err);
      return "failed";
    }
  }

  const next = upsertIndexDay(index, { date, readingChapters });
  return (await putSnapIndex(JSON.stringify(next))) ? "written" : "failed";
}

export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const date = sydneyToday();
  const [portfolio, reading, snapkey, snapIndex] = await Promise.all([
    getPortfolio(),
    getCurrentlyReading(),
    getSnapkey(),
    getSnapIndex(),
  ]);

  const [box, index, swept] = await Promise.all([
    sealBox(portfolio, snapkey, date),
    writeIndex(reading, snapIndex, date),
    // A sweep failure must never fail the snapshot (the sweep never throws anyway).
    sweepExpiredShares(Math.floor(Date.now() / 1000)).catch(() => -1),
  ]);

  return Response.json({
    date,
    box,
    index,
    swept,
    at: new Date().toISOString(),
  });
}
