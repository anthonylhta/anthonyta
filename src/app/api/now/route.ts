import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { DEFAULT_NOW, NOW_MAX_BYTES, normalizeNow } from "@/lib/now";
import { getNowRaw, putNowRaw } from "@/lib/nowstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated read/write of the front door's "now" block. Plaintext by design —
 * the server prints it to every guest on the lobby (lib/now) — but the WRITE is
 * the owner's alone, and guests get the usual 404 wall (ADR 0022). GET folds
 * absent AND malformed into the defaults, exactly as the layout route does: the
 * block is rebuildable from the /system panel in a minute, so there is no
 * re-seed hazard to keep 404-distinct, and the panel always gets something
 * editable. A store flake stays 503 so the panel can say "try again" rather than
 * quietly offering to overwrite real words with defaults. PUT validates the
 * shape and revalidates the render cache so the edit is live at once.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const read = await getNowRaw();
    if (read.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (read.state === "absent")
      return Response.json(DEFAULT_NOW, {
        headers: { "cache-control": "no-store" },
      });
    let cfg = DEFAULT_NOW;
    try {
      cfg = normalizeNow(JSON.parse(read.value)) ?? DEFAULT_NOW;
    } catch {
      // malformed blob → editable defaults; the next save repairs it
    }
    return Response.json(cfg, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[now] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > NOW_MAX_BYTES) return nf();
    let cfg = null;
    try {
      cfg = normalizeNow(JSON.parse(body));
    } catch {
      cfg = null;
    }
    if (!cfg) return new Response("Bad request", { status: 400 });

    if (!(await putNowRaw(JSON.stringify(cfg)))) return nf();
    // Next 16's two-arg form (the layout route's precedent): expire now.
    revalidateTag("now", "max");
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[now] put failed", err);
    return nf();
  }
}
