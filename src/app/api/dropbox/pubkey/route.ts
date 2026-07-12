import { getDropboxKey } from "@/lib/dropstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * The public half of the owner's box keypair (ADR: sealed box, resurrected). A
 * deliberately PUBLIC read — like the share serve route (ADR 0058), a stranger's
 * browser needs this to seal a message the server can never open. It hands back the
 * PUBLIC point ONLY; the MK-sealed private half stored alongside it never leaves this
 * route's `read.value`. When the box isn't enabled or the store errors it 404s (no
 * enabled/disabled oracle, and the composer simply hides its form on a 404).
 */
export async function GET() {
  try {
    const read = await getDropboxKey();
    // absent (box not set up) and error (store off / hiccup) both collapse to 404 —
    // the form hides either way, and a probe learns nothing.
    if (read.state !== "ok") return nf();
    return Response.json(
      { pub_b64: read.value.pub_b64 },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[dropbox/pubkey] failed", err);
    return nf();
  }
}
