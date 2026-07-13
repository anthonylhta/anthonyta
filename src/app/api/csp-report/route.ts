import { emptyCspDay, foldReport, parseReports } from "@/lib/cspreport";
import { readDay, writeDay } from "@/lib/cspstore";
import { sydneyToday } from "@/lib/fin";
import { r2Enabled } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * First-party CSP violation collector (roadmap 37e). Deliberately PUBLIC — the policy's
 * `report-uri`/`report-to` directives point browsers here — but, exactly like /api/hit,
 * it never returns anything readable: every branch answers an empty 204, so a probe
 * can't turn it into a counter or an oracle. Reports are HOSTILE input (any origin can
 * POST here); cspreport sanitizes + allow-lists every field before a byte persists, and
 * the query/fragment of the violating page URL is dropped before it lands.
 *
 * Skipped (204, no write) when: the store is off, the per-instance flood window is
 * tripped, the body is oversized or unparseable, or nothing normalizes. Fully guarded:
 * a store hiccup no-ops rather than surfacing to the browser.
 */

const noContent = () => new Response(null, { status: 204 });

// A report body is a small JSON document; anything larger is junk we won't parse.
const MAX_BODY = 32 * 1024;

/**
 * Best-effort, per-instance flood window. A serverless deployment runs several
 * instances and recycles them, so this is a coarse first line only — the real bound on
 * blob growth is cspreport's distinct-key cap (overflow folds into one bucket). Global
 * (not per-IP): a CSP report carries no identity we'd want to store, and the point is
 * simply that no single instance folds unboundedly.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
let recent: number[] = [];

function overRate(): boolean {
  const now = Date.now();
  recent = recent.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  return recent.length > RATE_MAX;
}

export async function POST(req: Request) {
  // Drain the body FIRST, always — no branch may return before the read, or the
  // response timing itself would leak whether a report was accepted. The platform
  // bounds the raw read; MAX_BODY then caps what we're willing to PARSE. Either way
  // the answer is the same empty 204.
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return noContent();
  }

  try {
    if (!r2Enabled()) return noContent();
    if (raw.length > MAX_BODY) return noContent();
    if (overRate()) return noContent();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return noContent();
    }
    const reports = parseReports(parsed);
    if (reports.length === 0) return noContent();

    const today = sydneyToday();
    const read = await readDay(today);
    // An "error" read never rebuilds the day from empty — that would clobber the day's
    // counts on a flaky fetch. "absent" is a genuine fresh day.
    if (read.state === "error") return noContent();
    const day = read.state === "ok" ? read.value : emptyCspDay(today);
    for (const r of reports) foldReport(day, r);
    await writeDay(day);
  } catch {
    // Collection is best-effort; a store/parse failure must never surface to the
    // browser — the reporter gets its 204 regardless.
  }
  return noContent();
}
