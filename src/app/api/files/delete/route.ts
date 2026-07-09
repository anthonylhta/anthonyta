import { auth } from "@/auth";
import { isValidPathname } from "@/lib/files";
import { deleteFile } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated delete of one inbox blob by pathname (ADR 0051). Guests, a missing or
 * malformed pathname, or a store that refuses the delete all collapse to a 404 — the
 * hidden-private-mode contract the vault routes follow (ADR 0022). `deleteFile`
 * re-validates the pathname internally.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const { pathname } = await request
    .json()
    .catch(() => ({}) as { pathname?: string });
  if (!pathname || !isValidPathname(pathname)) return nf();

  const ok = await deleteFile(pathname);
  return ok ? Response.json({ ok: true }) : nf();
}
