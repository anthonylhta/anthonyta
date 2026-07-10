import { auth } from "@/auth";
import { isSnapkey } from "@/lib/crypto";
import { SNAPKEY_MAX_BYTES } from "@/lib/fin";
import { getSnapkey, putSnapkey } from "@/lib/finstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the snapkey (ADR: sealed net worth) — the owner's static
 * ECDH public point (the nightly cron seals snapshots TO it) plus the private half
 * sealed under the master key. The server holds it but can't open a box; guests get
 * the 404 wall (ADR 0022). Past the auth gate absent (404, first-run) and error (503,
 * a flake) stay distinct so a re-key can't be triggered by a transient read failure.
 * PUT validates with the same `isSnapkey` the client uses and REBUILDS from the four
 * validated fields, so what's at rest is exactly the snapkey shape — never a superset
 * smuggled past the guard — and won't clobber an existing key without an explicit
 * `x-snapkey-overwrite: 1` (conflict → 409).
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const key = await getSnapkey();
    if (key.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (key.state === "absent") return nf();

    return new Response(key.value, {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[fin/snapkey] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > SNAPKEY_MAX_BYTES) return nf();
    const parsed: unknown = JSON.parse(body);
    if (!isSnapkey(parsed)) return nf();

    // Rebuild from the validated fields so what's at rest is exactly the snapkey
    // shape, never a superset smuggled past the type guard.
    const overwrite = request.headers.get("x-snapkey-overwrite") === "1";
    const result = await putSnapkey(
      JSON.stringify({
        v: parsed.v,
        alg: parsed.alg,
        pub_b64: parsed.pub_b64,
        sealed_priv_b64: parsed.sealed_priv_b64,
      }),
      overwrite,
    );
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[fin/snapkey] put failed", err);
    return nf();
  }
}
