import { handleUpload } from "@vercel/blob/client";
import { auth } from "@/auth";
import { isEncrypted, isValidPathname } from "@/lib/files";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Client-upload token exchange for the owner-only files inbox (ADR 0051). The browser
 * uploads straight to the private Blob store; this route only mints the scoped token,
 * so the owner gate lives in `onBeforeGenerateToken` — a throw there denies the upload.
 * Any failure (guest, forged pathname, bad body, SDK error) collapses to a 404, the
 * hidden-private-mode contract the vault routes follow (ADR 0022).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const session = await auth();
        if (!session?.user) throw new Error("unauthorized");
        if (!isValidPathname(pathname)) throw new Error("bad pathname");
        // Only E2EE envelopes get tokens (ADR 0053) — the client always seals
        // before upload, so a plaintext-shaped name here is a bug or a forgery.
        if (!isEncrypted(pathname)) throw new Error("not an envelope");
        return {
          // 25MB of content + headroom for the ~300B E2EE envelope overhead.
          maximumSizeInBytes: 26 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: null,
        };
      },
      onUploadCompleted: async () => {
        // Never fires on localhost (no public callback URL); the client refreshes the
        // inbox listing itself once the upload resolves.
      },
    });
    return Response.json(result);
  } catch (err) {
    console.error("[files/upload] failed", err);
    return nf();
  }
}
