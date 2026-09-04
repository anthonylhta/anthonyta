import { auth } from "@/auth";
import { hasAevMagic, MAGIC } from "@/lib/crypto";
import { GU_MARKS_MAX_BYTES } from "@/lib/gumarks";
import { getGuMarks, putGuMarks } from "@/lib/gumarksstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the E2EE gu-book marks envelope — the owner's word
 * about the book, recorded from /gu the moment it happens: a refinement begun,
 * a consumable cast. Sealed under the vault master key so the server only ever
 * holds ciphertext (the jobs pattern, ADR 0166). Guests get the 404 wall
 * (ADR 0022). Past the gate, absent and error stay distinguishable: a missing
 * envelope is first-run (404) while a store flake is 503. PUT sanity-checks
 * only the envelope FRAME (size + magic) and refuses to overwrite without an
 * explicit `x-gu-marks-overwrite: 1`.
 */

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
// 4 magic + 12 IV + 16 GCM tag + at least 1 ciphertext byte.
const MIN_ENVELOPE_BYTES = MAGIC_BYTES.length + 12 + 16 + 1;

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const cfg = await getGuMarks();
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
    console.error("[gu-marks] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());

    // Frame sanity only — the server can't (and must never) decrypt.
    if (bytes.byteLength > GU_MARKS_MAX_BYTES) return nf();
    if (bytes.byteLength < MIN_ENVELOPE_BYTES) return nf();
    if (!hasAevMagic(bytes)) return nf();

    const overwrite = request.headers.get("x-gu-marks-overwrite") === "1";
    const result = await putGuMarks(bytes, overwrite);
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[gu-marks] put failed", err);
    return nf();
  }
}
