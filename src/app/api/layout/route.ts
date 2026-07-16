import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { EMPTY_LAYOUT, LAYOUT_MAX_BYTES, normalizeLayout } from "@/lib/layout";
import { getLayoutRaw, putLayoutRaw } from "@/lib/layoutstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated read/write of the layout config (roadmap 59). Plaintext by
 * design — the server renders the public lobby from it (lib/layout.ts) — but
 * the WRITE is the owner's alone, and guests get the usual 404 wall (ADR
 * 0022). GET folds absent AND malformed into the empty (all-visible) config:
 * this store is rebuildable from the /system panel in seconds, so there is no
 * re-seed hazard to keep 404-distinct, and the panel always gets something
 * editable. A store flake stays 503 so the panel can say "try again" rather
 * than quietly offering to overwrite with defaults. PUT validates the shape
 * and revalidates the render cache so the save is visible immediately.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const read = await getLayoutRaw();
    if (read.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (read.state === "absent")
      return Response.json(EMPTY_LAYOUT, {
        headers: { "cache-control": "no-store" },
      });
    let cfg = EMPTY_LAYOUT;
    try {
      cfg = normalizeLayout(JSON.parse(read.value)) ?? EMPTY_LAYOUT;
    } catch {
      // malformed blob → editable defaults; the next save repairs it
    }
    return Response.json(cfg, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[layout] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > LAYOUT_MAX_BYTES) return nf();
    let cfg = null;
    try {
      cfg = normalizeLayout(JSON.parse(body));
    } catch {
      cfg = null;
    }
    if (!cfg) return new Response("Bad request", { status: 400 });

    if (!(await putLayoutRaw(JSON.stringify(cfg)))) return nf();
    // Next 16's two-arg form (the ingest route's precedent): expire now.
    revalidateTag("layout", "max");
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[layout] put failed", err);
    return nf();
  }
}
