import { auth } from "@/auth";
import { hasAevMagic, MAGIC } from "@/lib/crypto";
import { FIN_MAX_BYTES } from "@/lib/fin";
import { getFinConfig, putFinConfig } from "@/lib/finstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the E2EE fin-config envelope (ADR: sealed net worth) — the
 * cash/HISA balance series, sealed under the master key so the server only ever holds
 * ciphertext. Serving it to the owner reveals nothing without the passphrase; guests
 * get the usual 404 wall (ADR 0022). Past the auth gate, absent and error stay
 * distinguishable (the PR #59 keystore lesson): a missing config is first-run setup
 * (404), while a transient store failure answers 503 — a flake must never masquerade
 * as "nothing exists yet" and lure a re-seed that orphans the real data. PUT
 * sanity-checks only the envelope FRAME (size + `AEV1` magic) — the server never
 * decrypts — and refuses to clobber an existing config without an explicit
 * `x-fin-overwrite: 1` (conflict → 409).
 */

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
// 4 magic + 12 IV + 16 GCM tag + at least 1 ciphertext byte.
const MIN_ENVELOPE_BYTES = MAGIC_BYTES.length + 12 + 16 + 1;

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const cfg = await getFinConfig();
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
    console.error("[fin/config] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());

    // Frame sanity only — the server can't (and must never) decrypt. Reject an
    // oversize blob, one too short to even hold the envelope header, or one whose
    // first four bytes aren't a sealed-envelope magic (AEV1, or the context-bound
    // AEV2 the client now seals — ADR 0099). The server checks the frame, never
    // the contents.
    if (bytes.byteLength > FIN_MAX_BYTES) return nf();
    if (bytes.byteLength < MIN_ENVELOPE_BYTES) return nf();
    if (!hasAevMagic(bytes)) return nf();

    const overwrite = request.headers.get("x-fin-overwrite") === "1";
    const result = await putFinConfig(bytes, overwrite);
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[fin/config] put failed", err);
    return nf();
  }
}
