import { auth } from "@/auth";
import { isValidPathname } from "@/lib/files";
import { readFileStream } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated same-origin ciphertext stream for one inbox blob (ADR 0053). E2EE
 * envelopes are decrypted in the browser, and a presigned blob URL can't be assumed
 * CORS-readable from JS — so the bytes proxy through here instead. That costs zero
 * privacy: what transits this function is ciphertext the server already stores.
 * The body is passed through as a stream (never buffered), `isValidPathname`'s
 * `inbox/` prefix requirement structurally rejects `meta/keystore` and traversal
 * probes, and every failure is a 404 — the vault contract (ADR 0022).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const p = new URL(request.url).searchParams.get("p");
  if (!p || !isValidPathname(p)) return nf();

  const stream = await readFileStream(p);
  if (!stream) return nf();

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
