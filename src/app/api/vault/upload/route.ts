import { auth } from "@/auth";
import { r2Enabled, r2PresignPut } from "@/lib/r2";
import { isValidVaultPath } from "@/lib/vaultblob";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

// Mirrors /api/files/upload: 25MB of content + envelope headroom, enforced on
// the DECLARED size at mint time — a guard against accidents, not adversaries
// (the route is owner-only, and vault images run single-digit MB).
const MAX_BYTES = 26 * 1024 * 1024;
const PUT_TTL_SECONDS = 900;

/**
 * Presigned-PUT mint for `vault/*` ciphertext — the rotation walk's write path
 * (ADR 0090/0103). Until now vault blobs were written only by the owner-run
 * vault-sync script signing its own R2 requests; the browser-side walk needs to
 * re-seal and overwrite them in place, and big image envelopes don't fit
 * through a function body, so it gets the same client-direct presign pattern as
 * the inbox (ADR 0060). `isValidVaultPath` admits ONLY the leaf shapes the
 * vault serves (`n-`/`i-` id blobs, the index, the search index, the integrity
 * manifest) — `meta/*` and `inbox/*` stay structurally unreachable, so a minted
 * URL can never touch key material. A presigned PUT overwrites unconditionally,
 * which is exactly the walk's contract (rewrite in place); the no-clobber
 * discipline protects the fixed config stores, not these content blobs. Any
 * failure collapses to 404 (ADR 0022).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const { pathname, size } = (await request.json()) as {
      pathname?: unknown;
      size?: unknown;
    };
    if (typeof pathname !== "string" || !isValidVaultPath(pathname))
      return nf();
    if (
      !Number.isInteger(size) ||
      (size as number) <= 0 ||
      (size as number) > MAX_BYTES
    )
      return nf();
    if (!r2Enabled()) return nf();

    const url = await r2PresignPut(pathname, PUT_TTL_SECONDS);
    return Response.json({ url });
  } catch (err) {
    console.error("[vault/upload] failed", err);
    return nf();
  }
}
