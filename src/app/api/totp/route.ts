import { auth } from "@/auth";
import { hasAevMagic, MAGIC } from "@/lib/crypto";
import { getTotpConfig, putTotpConfig, TOTP_MAX_BYTES } from "@/lib/totpstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the E2EE TOTP envelope (ADR: TOTP drawer) — the 2FA
 * seed list, sealed under the master key so the server only ever holds
 * ciphertext. Serving it to the owner reveals nothing without the passphrase;
 * guests get the usual 404 wall (ADR 0022). Past the auth gate, absent and
 * error stay distinguishable (the keystore lesson): a missing envelope is an
 * empty drawer (404), while a transient store failure answers 503 — a flake
 * must never masquerade as "no seeds yet" and lure a first-write that clobbers
 * the real list. PUT sanity-checks only the envelope FRAME (size + AEV magic)
 * — the server never decrypts — and refuses to clobber an existing envelope
 * without an explicit `x-totp-overwrite: 1` (conflict → 409).
 */

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
// 4 magic + 12 IV + 16 GCM tag + at least 1 ciphertext byte.
const MIN_ENVELOPE_BYTES = MAGIC_BYTES.length + 12 + 16 + 1;

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const cfg = await getTotpConfig();
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
    console.error("[totp] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());

    // Frame sanity only — the server can't (and must never) decrypt.
    if (bytes.byteLength > TOTP_MAX_BYTES) return nf();
    if (bytes.byteLength < MIN_ENVELOPE_BYTES) return nf();
    if (!hasAevMagic(bytes)) return nf();

    const overwrite = request.headers.get("x-totp-overwrite") === "1";
    const result = await putTotpConfig(bytes, overwrite);
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[totp] put failed", err);
    return nf();
  }
}
