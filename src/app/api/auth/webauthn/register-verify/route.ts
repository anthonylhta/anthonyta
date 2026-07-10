import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { auth } from "@/auth";
import { toB64url } from "@/lib/crypto";
import {
  challengeClearCookie,
  challengeFromCookieHeader,
  openChallenge,
} from "@/lib/webauthn/cookie";
import {
  appendCred,
  isWebauthnRecord,
  newRecord,
  withRecovery,
  type WebauthnRecord,
} from "@/lib/webauthn/record";
import { hashRecoveryCode, mintRecoveryCode } from "@/lib/webauthn/recovery";
import { rpConfig } from "@/lib/webauthn/rp";
import {
  bootstrapOpen,
  getWebauthnRecord,
  putWebauthnRecord,
} from "@/lib/webauthn/store";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16_384;

const nf = () => new Response("Not found", { status: 404 });
const unavailable = () => new Response("Unavailable", { status: 503 });

/**
 * Finish a passkey enrollment — owner-gated like its options twin. Verifies
 * the attestation against the challenge from the signed cookie, then appends
 * the credential to `meta/webauthn` (rebuilt from validated fields only, the
 * keystore PUT discipline). The FIRST enrollment also mints the one-time
 * break-glass recovery code: its hash is sealed into the record and the code
 * itself is returned exactly once for the owner to keep offline. That first
 * write refuses to overwrite (409 on a race) so a replayed bootstrap can
 * never clobber an existing record.
 *
 * The break-glass bootstrap (flag set + record strictly absent) is the one
 * sessionless path in; its write still refuses to overwrite, so it closes
 * itself the instant a record exists.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user && !(await bootstrapOpen())) return nf();

  const rp = rpConfig();
  const clear = { "set-cookie": challengeClearCookie(rp.secure) };

  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return nf();
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return nf();
    const { response, label } = parsed as {
      response?: unknown;
      label?: unknown;
    };
    if (typeof response !== "object" || response === null) return nf();

    const sealed = challengeFromCookieHeader(request.headers.get("cookie"));
    const challenge = sealed
      ? openChallenge(sealed, "reg", process.env.AUTH_SECRET ?? "")
      : null;
    if (!challenge)
      return new Response("Expired", { status: 400, headers: clear });

    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!verified || !registrationInfo)
      return new Response("Rejected", { status: 400, headers: clear });

    const cred = {
      id: registrationInfo.credential.id,
      pk: toB64url(registrationInfo.credential.publicKey),
      counter: registrationInfo.credential.counter,
      transports: registrationInfo.credential.transports?.map(String),
      label: sanitizeLabel(label),
      createdAt: new Date().toISOString(),
    };

    const read = await getWebauthnRecord();
    if (read.state === "error") return unavailable();

    if (read.state === "absent") {
      const code = mintRecoveryCode();
      const record = withRecovery(
        appendCred(newRecord(), cred)!,
        hashRecoveryCode(code),
        new Date().toISOString(),
      );
      const wrote = await putWebauthnRecord(JSON.stringify(record), false);
      if (wrote === "conflict")
        return new Response("Conflict", { status: 409, headers: clear });
      if (wrote !== "ok") return unavailable();
      return Response.json({ ok: true, recovery: code }, { headers: clear });
    }

    let record: unknown;
    try {
      record = JSON.parse(read.value);
    } catch {
      return unavailable();
    }
    if (!isWebauthnRecord(record)) return unavailable();

    const next = appendCred(record as WebauthnRecord, cred);
    if (!next) return new Response("Conflict", { status: 409, headers: clear });
    const wrote = await putWebauthnRecord(JSON.stringify(next), true);
    if (wrote !== "ok") return unavailable();
    return Response.json({ ok: true }, { headers: clear });
  } catch (err) {
    console.error("[webauthn] register-verify failed", err);
    return new Response("Rejected", { status: 400, headers: clear });
  }
}

/** Owner-facing device name: lowercase, bounded, never empty. */
function sanitizeLabel(label: unknown): string {
  const s = typeof label === "string" ? label.trim().toLowerCase() : "";
  return s.length > 0 ? s.slice(0, 64) : "passkey";
}
