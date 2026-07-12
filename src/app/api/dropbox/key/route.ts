import { auth } from "@/auth";
import { isDropboxKey, type DropboxKey } from "@/lib/dropbox";
import {
  DROPBOX_KEY_MAX_BYTES,
  getDropboxKey,
  putDropboxKey,
} from "@/lib/dropstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the box keypair record (ADR: sealed box, resurrected). The
 * record holds the public point plus the MK-sealed private half — serving it to the
 * owner reveals nothing without the passphrase, and guests get the usual 404 wall
 * (ADR 0022). Past the auth gate, absent and error stay distinguishable: a missing
 * record is first-run setup (404), while a transient store failure answers 503 — a
 * flake must never masquerade as "no box yet" and lure a re-seed that orphans every
 * message sealed to the old key. PUT validates the record shape with the same
 * `isDropboxKey` the client uses and writes no-clobber (conflict → 409), so setup
 * physically cannot overwrite an existing box.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  const read = await getDropboxKey();
  if (read.state === "error")
    return new Response("Unavailable", { status: 503 });
  if (read.state === "absent") return nf();

  return Response.json(read.value, {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > DROPBOX_KEY_MAX_BYTES) return nf();
    const parsed: unknown = JSON.parse(body);
    if (!isDropboxKey(parsed)) return nf();

    // Rebuild from the validated fields so what's at rest is exactly the record
    // shape, never a superset smuggled past the type guard.
    const rec: DropboxKey = {
      v: parsed.v,
      alg: parsed.alg,
      pub_b64: parsed.pub_b64,
      sealed_priv_b64: parsed.sealed_priv_b64,
    };
    // No-clobber always: the box is minted once. A second setup finds the record
    // already there and refuses (conflict → 409) rather than orphaning messages.
    const result = await putDropboxKey(rec, false);
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[dropbox/key] put failed", err);
    return nf();
  }
}
