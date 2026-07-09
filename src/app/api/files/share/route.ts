import { put } from "@vercel/blob";
import { auth } from "@/auth";
import { INBOX_PREFIX, sanitizePathname } from "@/lib/files";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * PWA share-target endpoint (the manifest's `share_target`). Android's share sheet
 * POSTs the shared file here as multipart/form-data; we drop it into the private
 * `inbox/` Blob store and 303 back to /files so the browser lands on the inbox with
 * a GET. Owner-gated like the rest of the inbox (ADR 0022) — a guest gets a 404.
 *
 * Any failure AFTER the auth gate — the platform's 4.5MB function-body cap, a
 * formData parse error, a Blob write throw — redirects to /files?share=failed rather
 * than 404ing: the owner is mid-share on a phone, and a redirect beats a dead page.
 * Pre-auth failures stay 404 so the private mode never leaks.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const failed = () =>
    Response.redirect(new URL("/files?share=failed", request.url), 303);

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return failed();

    await put(INBOX_PREFIX + sanitizePathname(file.name), file, {
      access: "private",
      addRandomSuffix: true,
      contentType: file.type || undefined,
    });

    return Response.redirect(new URL("/files", request.url), 303);
  } catch (err) {
    console.error("[files/share] upload failed", err);
    return failed();
  }
}
