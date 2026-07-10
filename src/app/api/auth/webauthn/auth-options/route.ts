import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { challengeSetCookie, sealChallenge } from "@/lib/webauthn/cookie";
import { rpConfig } from "@/lib/webauthn/rp";

export const dynamic = "force-dynamic";

/**
 * Start a passkey sign-in — the only public WebAuthn endpoint, and deliberately
 * inert: no auth gate (guests ARE the callers — this is how the owner signs
 * in), no store read, and an EMPTY allow list. Every enrolled passkey is
 * discoverable, so the browser finds it locally; naming credential IDs here
 * would hand any guest proof that the door exists and a list of the keys that
 * open it. The response is byte-shaped the same whether zero or twelve
 * credentials exist, with or without a blob token — a probe learns nothing
 * (ADR 0022), and the pipeline stays green with zero secrets.
 */
export async function POST() {
  const rp = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: [],
    userVerification: "required",
  });

  return Response.json(options, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": challengeSetCookie(
        sealChallenge(options.challenge, "auth", process.env.AUTH_SECRET ?? ""),
        rp.secure,
      ),
    },
  });
}
