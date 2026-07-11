import { auth } from "@/auth";
import { isEncrypted, isValidPathname, isValidSharePath } from "@/lib/files";
import { r2Enabled, r2PresignPut } from "@/lib/r2";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

// 25MB of content + headroom for the ~300B E2EE envelope overhead. Enforced on
// the DECLARED size at mint time — a presigned PUT can't bind a byte count, so
// the cap is a guard against accidents, not adversaries (the route is owner-only).
const MAX_BYTES = 26 * 1024 * 1024;

// Generous window for a big envelope on a slow mobile uplink; R2 checks validity
// when the request ARRIVES, so an upload that started in-window completes fine.
const PUT_TTL_SECONDS = 900;

/**
 * Presigned-PUT mint for the owner-only files inbox (ADR 0051, R2 since ADR 0060).
 * The browser uploads ciphertext straight to the bucket; this route only signs the
 * URL, so the owner gate and the pathname discipline live here. Two shapes are
 * admitted, both OWNER-ONLY: E2EE inbox envelopes under `inbox/` (ADR 0053) and
 * fragment-key share envelopes under `share/` (ADR 0058) — the prefix validation
 * structurally excludes `meta/*` and `vault/*`, so a minted URL can never touch
 * key material. Only *reads* of `share/` are public (via /api/share/[id]); writing
 * one still needs the owner. Any failure (guest, forged pathname, bad body, store
 * off) collapses to a 404, the hidden-private-mode contract (ADR 0022).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const { pathname, size } = (await request.json()) as {
      pathname?: unknown;
      size?: unknown;
    };
    // An inbox blob must be a valid `inbox/` name AND an E2EE envelope (ADR 0053)
    // — the client always seals before upload, so a plaintext-shaped inbox name is
    // a bug or a forgery. A share envelope carries its own `share/<expiry>-e-….bin`
    // validity check (ADR 0058). Anything that's neither is rejected.
    const inboxOk =
      typeof pathname === "string" &&
      isValidPathname(pathname) &&
      isEncrypted(pathname);
    const shareOk = typeof pathname === "string" && isValidSharePath(pathname);
    if (!inboxOk && !shareOk) return nf();
    if (
      !Number.isInteger(size) ||
      (size as number) <= 0 ||
      (size as number) > MAX_BYTES
    )
      return nf();
    if (!r2Enabled()) return nf();

    const url = await r2PresignPut(pathname as string, PUT_TTL_SECONDS);
    return Response.json({ url });
  } catch (err) {
    console.error("[files/upload] failed", err);
    return nf();
  }
}
