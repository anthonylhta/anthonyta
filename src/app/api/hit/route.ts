import { auth } from "@/auth";
import { recordHit, todayVisitorHash } from "@/lib/anastore";
import { sydneyToday } from "@/lib/fin";
import { r2Enabled } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Cookieless pageview recorder (ADR: privacy-preserving analytics). Deliberately
 * PUBLIC — the public site's <Beacon/> POSTs `{ path }` here — but it never returns
 * anything readable: every branch answers an empty 204, so it can't be turned into a
 * counter or an oracle. Nothing identifying is stored: the (ip, ua) signal is hashed
 * once under a daily-rotating salt (anastore) and folded into an HLL sketch; the raw
 * ip and hash are dropped.
 *
 * Skipped (204, no write) when: the store is off, the UA looks like a crawler, `DNT`/
 * `Sec-GPC` opt-out is sent, or the request carries the OWNER's own session — the
 * dashboard counts visitors, not me. Fully guarded: a store hiccup no-ops rather than
 * erroring the response.
 */

const noContent = () => new Response(null, { status: 204 });

// A small deny-list — the common crawlers/preview-fetchers/tools; not exhaustive, and
// it doesn't need to be, since the point is traffic shape, not a precise headcount.
const CRAWLER =
  /bot|crawl|spider|slurp|bing|baidu|yandex|duckduck|facebookexternalhit|embedly|quora|pinterest|slackbot|telegram|whatsapp|discord|preview|monitor|lighthouse|headless|phantom|curl|wget|python-requests|axios|node-fetch/i;

const MAX_PATH = 512;

/** Any control byte (incl. newline) — never belongs in a pathname. */
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return true;
  return false;
}

/** A same-origin app path: a single leading slash, no scheme/host, no traversal or
 *  control bytes. `location.pathname` always matches; junk POSTs are dropped. */
function isAppPath(x: unknown): x is string {
  return (
    typeof x === "string" &&
    x.length > 0 &&
    x.length <= MAX_PATH &&
    x.startsWith("/") &&
    !x.startsWith("//") &&
    !x.includes("..") &&
    !x.includes("\\") &&
    !hasControl(x)
  );
}

export async function POST(req: Request) {
  try {
    if (!r2Enabled()) return noContent();

    const ua = req.headers.get("user-agent") ?? "";
    if (!ua || CRAWLER.test(ua)) return noContent();
    if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1")
      return noContent();

    // Skip the owner's own traffic — awaited before any store work, mirroring the
    // owner-route guard order.
    const session = await auth();
    if (session?.user) return noContent();

    let path: unknown;
    try {
      const body: unknown = await req.json();
      path = (body as { path?: unknown })?.path;
    } catch {
      return noContent();
    }
    if (!isAppPath(path)) return noContent();

    // First hop of x-forwarded-for is the client. Hashed immediately under the day's
    // salt; the raw ip is never stored.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const today = sydneyToday();
    const hash = await todayVisitorHash(today, ip, ua);
    if (hash) await recordHit(today, path, hash);
  } catch {
    // Recording is best-effort; a store/parse failure must never surface to the
    // client — the beacon gets its 204 regardless.
  }
  return noContent();
}
