import { getCash } from "@/lib/cash";
import { getPortfolio } from "@/lib/connectors/portfolio";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { authorizeCron } from "@/lib/cron-auth";
import { writeSnapshot } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

/** YYYY-MM-DD on the Sydney calendar day — snapshots are keyed the same way the
 *  digest reckons its trailing "this week" window. */
function sydneyDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/**
 * Daily snapshot of net worth + total reading chapters into the hub store (ADR 0033),
 * so the command center's "this week" digest can diff today against ~7 days ago. Runs
 * late each Sydney evening via Vercel Cron (vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; required, fail-closed in production (see
 * lib/cron-auth). No-ops cleanly when `HUB_DATABASE_URL` isn't configured (the write
 * store is guarded).
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const [portfolio, reading] = await Promise.all([
    getPortfolio(),
    getCurrentlyReading(),
  ]);

  // No portfolio CSV (Drive not configured / parse failed) → skip rather than write a
  // bogus net worth that would poison next week's delta. Reading alone isn't enough.
  if (!portfolio) {
    return Response.json({
      skipped: "no portfolio",
      at: new Date().toISOString(),
    });
  }

  const cash = getCash();
  const netWorthCents = Math.round(
    (portfolio.totals.value + cash.cash + cash.hisa) * 100,
  );
  const readingChapters = reading.reduce((sum, r) => sum + r.chapter, 0);

  const date = sydneyDate();
  const written = await writeSnapshot(date, { netWorthCents, readingChapters });
  return Response.json({ written, date, at: new Date().toISOString() });
}
