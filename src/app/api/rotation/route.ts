import { auth } from "@/auth";
import { hasAevMagic, MAGIC } from "@/lib/crypto";
import { deleteRotation, getRotation, putRotation } from "@/lib/rotatestore";
import { ROTATION_MAX_BYTES } from "@/lib/rotationset";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the master-key-rotation journal (ADR 0090) — progress
 * state sealed under the NEW master key, context-bound to its own path, so the
 * server only ever holds ciphertext and the journal dies with the rotation it
 * records. Guests get the usual 404 wall (ADR 0022). Past the auth gate, absent
 * and error stay distinguishable: no journal means no rotation in flight (404 —
 * the healthy answer), while a transient store failure answers 503 — a flake
 * misread as "no rotation" could lure a device into starting a SECOND rotation
 * over a live one, which the no-clobber first write (missing `x-rotation-
 * overwrite: 1` → conflict 409) refuses as the last line. PUT sanity-checks only
 * the envelope frame; DELETE is the completed rotation's cleanup, idempotent.
 */

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
// 4 magic + 12 IV + 16 GCM tag + at least 1 ciphertext byte.
const MIN_ENVELOPE_BYTES = MAGIC_BYTES.length + 12 + 16 + 1;

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const read = await getRotation();
    if (read.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (read.state === "absent") return nf();

    return new Response(read.value as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[rotation] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());

    // Frame sanity only — the server can't (and must never) decrypt. The shared
    // hasAevMagic accepts both sealed-envelope magics (the #119 lesson), even
    // though this store is AEV2 from birth.
    if (bytes.byteLength > ROTATION_MAX_BYTES) return nf();
    if (bytes.byteLength < MIN_ENVELOPE_BYTES) return nf();
    if (!hasAevMagic(bytes)) return nf();

    const overwrite = request.headers.get("x-rotation-overwrite") === "1";
    const result = await putRotation(bytes, overwrite);
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[rotation] put failed", err);
    return nf();
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    return (await deleteRotation())
      ? Response.json({ ok: true })
      : new Response("Unavailable", { status: 503 });
  } catch (err) {
    console.error("[rotation] delete failed", err);
    return nf();
  }
}
