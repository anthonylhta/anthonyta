import { auth } from "@/auth";
import { toB64url } from "@/lib/crypto";
import { listDrops, readDrop } from "@/lib/dropstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated listing of the sealed drop box (ADR: sealed box, resurrected). Guests
 * get the usual 404 wall (ADR 0022). Each envelope is small, so its ciphertext is
 * inlined as base64 alongside its path/size/time — the owner inbox opens them all in
 * one round-trip. What transits here is ciphertext the server already stores and can
 * never read; the private key that opens it lives only behind the passphrase. A row
 * that won't fetch is skipped rather than sinking the listing; the store being off
 * degrades to an empty list.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  const { objects } = await listDrops();
  const drops: {
    key: string;
    size: number;
    at: string;
    envelope_b64: string;
  }[] = [];
  for (const o of objects) {
    const bytes = await readDrop(o.key);
    if (!bytes) continue;
    drops.push({
      key: o.key,
      size: o.size,
      at: o.lastModified,
      envelope_b64: toB64url(bytes),
    });
  }

  return Response.json({ drops }, { headers: { "cache-control": "no-store" } });
}
