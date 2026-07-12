import { auth } from "@/auth";
import { isValidDropPath } from "@/lib/dropbox";
import { deleteDrop } from "@/lib/dropstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated delete of one sealed message by path — delete-on-read from the inbox
 * (ADR: sealed box, resurrected). Guests, a missing or malformed path, or a store that
 * refuses the delete all collapse to a 404 (ADR 0022). `deleteDrop` re-validates the
 * path internally, so the `dropbox/<id>.bin` framing structurally bars touching
 * `meta/*` or traversing out of the prefix.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const { path } = await request.json().catch(() => ({}) as { path?: string });
  if (typeof path !== "string" || !isValidDropPath(path)) return nf();

  const ok = await deleteDrop(path);
  return ok ? Response.json({ ok: true }) : nf();
}
