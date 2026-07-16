import { auth } from "@/auth";
import { recordAuthEvent } from "@/lib/authlogstore";
import { isKeystore } from "@/lib/crypto";
import { getKeystore, KEYSTORE_MAX_BYTES, putKeystore } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated access to the E2EE keystore (ADR 0053) — the passphrase-wrapped
 * master key at `meta/keystore`. The blob is ciphertext-of-a-key: serving it to the
 * owner reveals nothing without the passphrase, and guests get the usual 404 wall
 * (ADR 0022). Past the auth gate, absent and error stay distinguishable — the
 * client treats 404 as "run first-time setup" (which mints a FRESH master key), so
 * a transient read failure answering 404 could lure a re-entry into orphaning
 * every encrypted item; those answer 503 instead. PUT persists a keystore: shape
 * validated with the same `isKeystore` the client uses, size capped well above the
 * ~300B a real keystore occupies, and overwriting requires the explicit
 * `x-keystore-overwrite: 1` header (sent only by passphrase change) — first-run
 * setup physically cannot clobber an existing vault (conflict → 409).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  const ks = await getKeystore();
  if (ks.state === "error") return new Response("Unavailable", { status: 503 });
  if (ks.state === "absent") return nf();

  return new Response(ks.json, {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > KEYSTORE_MAX_BYTES) return nf();
    const parsed: unknown = JSON.parse(body);
    if (!isKeystore(parsed)) return nf();

    // Rebuild from the validated fields so what's at rest is exactly the
    // keystore shape, never a superset smuggled past the type guard. A v2
    // keystore carries the sealed canary (isKeystore guaranteed it's present);
    // v1 has none, so the field is only included when the version calls for it.
    const overwrite = request.headers.get("x-keystore-overwrite") === "1";
    const result = await putKeystore(
      JSON.stringify({
        v: parsed.v,
        kdf: {
          salt_b64: parsed.kdf.salt_b64,
          iterations: parsed.kdf.iterations,
        },
        wrapped_mk_b64: parsed.wrapped_mk_b64,
        iv_b64: parsed.iv_b64,
        ...(parsed.v === 2 ? { canary_b64: parsed.canary_b64 } : {}),
      }),
      overwrite,
    );
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    if (result === "ok")
      // A keystore overwrite is an attacker's favorite move (rotate the
      // passphrase, lock the owner out "mysteriously") — journal both paths.
      await recordAuthEvent(
        "keystore",
        overwrite
          ? "overwritten (passphrase change / re-wrap)"
          : "first-run setup",
      );
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[files/keystore] put failed", err);
    return nf();
  }
}
