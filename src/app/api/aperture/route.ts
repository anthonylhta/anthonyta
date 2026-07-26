import { auth } from "@/auth";
import { getAperture } from "@/lib/aperturestore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated read of the sealed aperture envelope — the private status document,
 * sealed under the master key so the server only ever holds ciphertext. Serving it
 * to the owner reveals nothing without the passphrase; guests get the usual 404
 * wall (ADR 0022), which for this module is the whole point: nothing aperture-shaped
 * may be reachable outside the owner session.
 *
 * GET only. The blob's single writer is the owner-run sync script, which puts to R2
 * directly — so there is no PUT here, and with no PUT there is no frame check and no
 * size cap to write: the route moves stored bytes and nothing else.
 *
 * Past the auth gate, absent and error stay distinguishable (the PR #59 keystore
 * lesson): nothing synced yet answers 404, a transient store failure answers 503. A
 * flake must never masquerade as "nothing exists yet".
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const doc = await getAperture();
    if (doc.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (doc.state === "absent") return nf();

    return new Response(doc.value as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[aperture] get failed", err);
    return nf();
  }
}
