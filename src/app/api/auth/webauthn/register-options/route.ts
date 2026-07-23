import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { auth } from "@/auth";
import { challengeSetCookie, sealChallenge } from "@/lib/webauthn/cookie";
import { isWebauthnRecord, type WebauthnRecord } from "@/lib/webauthn/record";
import { rpConfig, RP_NAME } from "@/lib/webauthn/rp";
import { bootstrapOpen, getWebauthnRecord } from "@/lib/webauthn/store";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Start a passkey enrollment — owner-gated (ADR 0022: guests get the 404 wall,
 * enrollment REQUIRES an already-authenticated session, so there is no
 * unauthenticated path to plant a credential). The challenge goes back in the
 * signed single-use cookie, not a server table. A store error is 503, never an
 * empty exclude list: options minted off a flaky read would invite enrolling a
 * duplicate of a credential the record already holds.
 *
 * The one exception to the session gate is the break-glass bootstrap: it needs
 * the `WEBAUTHN_BOOTSTRAP` secret presented in the `x-webauthn-bootstrap` header
 * AND a strictly-absent record — the lost-everything state where no credential
 * is left to enroll from. The secret, not the mere open window, is the gate.
 */
export async function POST(request: Request) {
  const session = await auth();
  const bootstrapToken = request.headers.get("x-webauthn-bootstrap");
  if (!session?.user && !(await bootstrapOpen(bootstrapToken))) return nf();

  const read = await getWebauthnRecord();
  if (read.state === "error")
    return new Response("Unavailable", { status: 503 });

  let record: WebauthnRecord = { v: 1, creds: [] };
  if (read.state === "ok") {
    try {
      const parsed: unknown = JSON.parse(read.value);
      if (!isWebauthnRecord(parsed))
        return new Response("Unavailable", { status: 503 });
      record = parsed;
    } catch {
      return new Response("Unavailable", { status: 503 });
    }
  }

  const rp = rpConfig();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: process.env.OWNER_GITHUB_LOGIN ?? "owner",
    // Fixed user handle: one owner, one logical user across every credential.
    userID: new TextEncoder().encode("owner"),
    attestationType: "none",
    excludeCredentials: record.creds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    // Discoverable + user-verified: the sign-in side sends an empty allow list
    // (leaking credential IDs to guests would advertise the door), so every
    // passkey must be resident; UV is the site's only second factor.
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    // Enable the PRF extension AT CREATION. Some authenticators (Android /
    // Google Password Manager, spec-strictly) only ever produce PRF output for
    // credentials that requested it when they were made — without this line a
    // passkey can sign in but silently can never do vault tap-unlock (ADR
    // 0064), which is exactly how the phone's "couldn't enable" presented.
    // Harmless where unsupported (the extension is ignored). The installed
    // @simplewebauthn/server type predates the prf field, hence the cast; the
    // value rides through to the browser's create() untouched.
    extensions: { prf: {} } as NonNullable<
      Parameters<typeof generateRegistrationOptions>[0]["extensions"]
    >,
  });

  return Response.json(options, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": challengeSetCookie(
        sealChallenge(options.challenge, "reg", process.env.AUTH_SECRET ?? ""),
        rp.secure,
      ),
    },
  });
}
