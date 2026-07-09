import { auth } from "@/auth";
import { isValidPathname } from "@/lib/files";
import { LINK_TTL_SECONDS, presignDownload } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated copy-link for one inbox blob (ADR 0051): a longer-lived signed URL plus
 * its ISO expiry, for sharing. Same presign path as /dl at a wider TTL. The response
 * is `no-store` so the URL is never cached past its window; guests and bad pathnames
 * get a 404 — the vault contract (ADR 0022).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const p = new URL(request.url).searchParams.get("p");
  if (!p || !isValidPathname(p)) return nf();

  try {
    const url = await presignDownload(p, LINK_TTL_SECONDS);
    if (!url) return nf();

    const expiresAt = new Date(
      Date.now() + LINK_TTL_SECONDS * 1000,
    ).toISOString();
    return Response.json(
      { url, expiresAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[files/link] presign failed", err);
    return nf();
  }
}
