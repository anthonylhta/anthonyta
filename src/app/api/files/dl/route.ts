import { auth } from "@/auth";
import { isValidPathname } from "@/lib/files";
import { DL_TTL_SECONDS, presignDownload } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated 302 to a short-lived signed download URL for one inbox blob (ADR 0051).
 * Private blobs have no public URL, so the pathname is presigned per request; the
 * redirect carries `no-store` because a cached redirect would outlive the presign
 * window. Guests and bad pathnames get a 404 — the vault contract (ADR 0022).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const p = new URL(request.url).searchParams.get("p");
  if (!p || !isValidPathname(p)) return nf();

  try {
    const url = await presignDownload(p, DL_TTL_SECONDS);
    if (!url) return nf();

    return new Response(null, {
      status: 302,
      headers: { location: url, "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[files/dl] presign failed", err);
    return nf();
  }
}
