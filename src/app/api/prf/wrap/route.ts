import { auth } from "@/auth";
import { recordAuthEvent } from "@/lib/authlogstore";
import { isPrfWrapSet } from "@/lib/prf";
import {
  getPrfWrapSet,
  PRF_WRAP_MAX_BYTES,
  putPrfWrapSet,
} from "@/lib/prfstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the passkey PRF wrap set (ADR: PRF unlock) — the
 * second wrapping of the master key, keyed by credential id, that lets a
 * biometric tap open the vault alongside the passphrase. Every wrap is
 * ciphertext-of-a-key: serving it to the owner reveals nothing without the
 * authenticator's PRF secret, and guests get the usual 404 wall (ADR 0022).
 * Past the auth gate, absent and error stay distinguishable (the keystore
 * lesson): no wraps enrolled yet is a healthy 404, while a transient store
 * failure answers 503 — a flake must never masquerade as "nothing enrolled".
 * PUT validates the whole set with the same `isPrfWrapSet` the client uses and
 * rebuilds it from the validated fields; a single owner read-modify-writes the
 * set, so the write overwrites unconditionally.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const set = await getPrfWrapSet();
    if (set.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (set.state === "absent") return nf();

    return Response.json(set.value, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[prf/wrap] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > PRF_WRAP_MAX_BYTES) return nf();
    const parsed: unknown = JSON.parse(body);
    if (!isPrfWrapSet(parsed)) return nf();

    // The PUT replaces the whole set, so the journal kind reads off the count
    // delta against what was stored (grow → add, shrink → remove); the detail
    // carries the exact transition either way.
    const prior = await getPrfWrapSet();
    const priorCount = prior.state === "ok" ? prior.value.wraps.length : 0;

    // Rebuild from the validated fields so what's at rest is exactly the wrap-set
    // shape, never a superset smuggled past the type guard.
    const ok = await putPrfWrapSet({
      v: 1,
      wraps: parsed.wraps.map((w) => ({
        v: 1,
        credential_id_b64: w.credential_id_b64,
        wrapped_mk_b64: w.wrapped_mk_b64,
        iv_b64: w.iv_b64,
      })),
    });
    if (ok)
      await recordAuthEvent(
        parsed.wraps.length < priorCount ? "prf-remove" : "prf-add",
        `wraps ${priorCount} → ${parsed.wraps.length}`,
      );
    return ok
      ? Response.json({ ok: true })
      : new Response("Unavailable", { status: 503 });
  } catch (err) {
    console.error("[prf/wrap] put failed", err);
    return nf();
  }
}
