import { runBackup, runSweep } from "@/lib/backupcron";
import { authorizeCron } from "@/lib/cron-auth";
import { sydneyToday } from "@/lib/fin";
import { r2Enabled } from "@/lib/r2";

export const dynamic = "force-dynamic";
// ~1,000 server-side copies at 8 in flight, then the sweep — well inside this,
// but past the default ceiling on a slow night.
export const maxDuration = 300;

/**
 * Nightly in-bucket backup (lib/backupcron). Two jobs, in order:
 *
 * - `copy`  — every object under `meta/`, `inbox/`, `vault/` copied server-side
 *             to `backup/<Sydney date>/<key>`, then that night's `index.json`.
 *             A failed copy is counted, never fatal.
 * - `sweep` — dated copies outside the newest seven are deleted. It runs only
 *             AFTER the copy, so tonight's date is already among the seven.
 *
 * Each job fails on its own (`-1` in the report) without sinking the other. The
 * owner's `meta/chores/backup` stamp is never written here: it tracks the local,
 * off-bucket copy, which this does not replace.
 *
 * Runs half an hour after `/api/cron/snapshot` via Vercel Cron (vercel.json), so
 * the two never overlap. Same fail-closed `CRON_SECRET` gate (lib/cron-auth).
 */
export async function GET(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  if (!r2Enabled()) return Response.json({ skipped: "store off" });

  const date = sydneyToday();
  const { copied, failed } = await runBackup(date).catch((err) => {
    console.error("[cron:backup] copy failed:", err);
    return { copied: -1, failed: -1 };
  });
  const { deleted, kept } = await runSweep().catch((err) => {
    console.error("[cron:backup] sweep failed:", err);
    return { deleted: -1, kept: -1 };
  });

  return Response.json({
    date,
    copied,
    failed,
    deleted,
    kept,
    at: new Date().toISOString(),
  });
}
