import { auth } from "@/auth";
import { listEstate } from "@/lib/rotatestore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated estate listing for the rotation walk (ADR 0090): every key + size
 * across the hub's prefixes, so the browser-side classifier (lib/rotationset)
 * can fail closed over the COMPLETE picture. Metadata only — keys and sizes the
 * server/bucket already see; no content moves. Guests get the 404 wall
 * (ADR 0022). A partial or failed listing answers 503, never a shortened array:
 * a rotation planned over a truncated estate would leave the missing blobs
 * sealed under the retiring key.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const entries = await listEstate();
    if (entries === null) return new Response("Unavailable", { status: 503 });
    return Response.json(
      { entries },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[rotation/listing] failed", err);
    return nf();
  }
}
