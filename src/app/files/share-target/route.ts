import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * Server fallback for the PWA share-target (ADR 0053). The service worker
 * normally intercepts this POST on-device, stashes the files, and the inbox
 * page encrypts them — so in the happy path this route never runs. Landing here
 * means the SW missed (fresh install before first activation, mid-deploy
 * update). Storing the body would mean accepting plaintext, so it stores
 * nothing: the owner gets bounced to the inbox with the failure banner and
 * shares again; a guest gets the usual 404 wall (ADR 0022).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Not found", { status: 404 });

  return Response.redirect(new URL("/files?share=failed", request.url), 303);
}
