import { auth } from "@/auth";
import { CIRCLE_MAX_BYTES } from "@/lib/circlemarks";
import { getCircle, putCircle } from "@/lib/circlestore";
import { hasAevMagic, MAGIC } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the E2EE circle envelope — the bar standing open and
 * the ones met since the last seal, written from /aperture the moment they
 * happen. Sealed under the vault master key so the server only ever holds
 * ciphertext (the gu-marks pattern, ADR 0175). Guests get the 404 wall
 * (ADR 0022). Past the gate, absent and error stay distinguishable: a missing
 * envelope is first-run (404) while a store flake is 503. PUT sanity-checks
 * only the envelope FRAME (size + magic) and refuses to overwrite without an
 * explicit `x-circle-overwrite: 1`.
 */

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
// 4 magic + 12 IV + 16 GCM tag + at least 1 ciphertext byte.
const MIN_ENVELOPE_BYTES = MAGIC_BYTES.length + 12 + 16 + 1;

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const cfg = await getCircle();
    if (cfg.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (cfg.state === "absent") return nf();

    return new Response(cfg.value as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[circle] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());

    // Frame sanity only — the server can't (and must never) decrypt.
    if (bytes.byteLength > CIRCLE_MAX_BYTES) return nf();
    if (bytes.byteLength < MIN_ENVELOPE_BYTES) return nf();
    if (!hasAevMagic(bytes)) return nf();

    const overwrite = request.headers.get("x-circle-overwrite") === "1";
    const result = await putCircle(bytes, overwrite);
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[circle] put failed", err);
    return nf();
  }
}
