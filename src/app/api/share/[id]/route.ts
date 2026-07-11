import { parseShareSegment } from "@/lib/files";
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

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
