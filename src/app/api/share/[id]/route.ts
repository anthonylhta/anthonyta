import { parseShareSegment } from "@/lib/files";
import { pushAfter } from "@/lib/pushsend";
import { readShareStream } from "@/lib/shares";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * The ONE deliberately PUBLIC blob-serving route in a hub that 404s guests
 * everywhere else (ADR 0022, 0058). It streams CIPHERTEXT only: a share envelope is
 * sealed on the owner's device and the decryption key rides in the URL `#fragment`,
 * which the browser never sends — so the server hands out bytes it cannot read, and a
 * recipient who is NOT the owner is expected here. Hence no `auth()` gate.
 *
 * It structurally CANNOT serve an inbox/meta/vault blob. The route's only store
 * interaction is `readShareStream(id, …)`, and that helper prepends `share/` and
 * appends `.bin` before reading — the reconstructed key is always `share/<id>.bin`.
 * A traversal or non-share `id` fails `parseShareSegment` first (→ 404), and even if
 * one slipped past, the fixed `share/….bin` framing leaves no path by which a
 * `meta/keystore` or `inbox/*` byte could ever be returned. The route never builds a
 * blob key itself.
 *
 * Every rejection — malformed id, expired share, absent blob — collapses to the same
 * 404, so a probe learns nothing (no existence/expiry oracle). `readShareStream`
 * folds expiry + existence into a single `null`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // `<expiry>-e-<22 b64url>` only — a traversal or junk segment stops here.
  if (!parseShareSegment(id)) return nf();

  // The sole blob touch, and it is share-scoped: `id` → `share/<id>.bin`.
  const stream = await readShareStream(id, Math.floor(Date.now() / 1000));
  if (!stream) return nf();

  // A collection is worth knowing about, and it is only a collection once the
  // bytes are actually going out — past the segment gate and past expiry, so a
  // probe can never buzz the phone. AFTER the response for the drop box's
  // reason: a served share must not be measurably slower than a 404'd one, or
  // the timing tells a prober which ids exist.
  //
  // EVERY collection notifies — deliberately no dedup. One buzz per link would
  // hide the second collection, and the second collection is the signal: the
  // recipient already has the file, so someone else walking the link means it
  // leaked. The line names nothing (no id, no filename); the server can't read
  // the envelope anyway, and a notification renders on a locked screen.
  pushAfter("share", "a share link was collected", "/files");

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
