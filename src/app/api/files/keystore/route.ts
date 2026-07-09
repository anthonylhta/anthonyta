import { auth } from "@/auth";
import { isKeystore } from "@/lib/crypto";
import { getKeystore, KEYSTORE_MAX_BYTES, putKeystore } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated access to the E2EE keystore (ADR 0053) — the passphrase-wrapped
 * master key at `meta/keystore`. The blob is ciphertext-of-a-key: serving it to the
 * owner reveals nothing without the passphrase, and guests get the usual 404 wall
 * (ADR 0022). GET 404s when no keystore exists yet — the client reads that as
 * "run first-time setup" (it can tell absent from store-offline via the page's SSR
 * flag). PUT is how setup and passphrase-change persist a new keystore: shape is
 * validated with the same `isKeystore` the client uses, size is capped well above
 * the ~300B a real keystore occupies, and anything malformed collapses to 404.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  const json = await getKeystore();
  if (!json) return nf();

  return new Response(json, {
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
    // keystore shape, never a superset smuggled past the type guard.
    const ok = await putKeystore(
      JSON.stringify({
        v: parsed.v,
        kdf: {
          salt_b64: parsed.kdf.salt_b64,
          iterations: parsed.kdf.iterations,
        },
        wrapped_mk_b64: parsed.wrapped_mk_b64,
        iv_b64: parsed.iv_b64,
      }),
    );
    return ok ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[files/keystore] put failed", err);
    return nf();
  }
}
