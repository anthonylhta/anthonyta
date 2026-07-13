import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyDoor } from "@/lib/webauthn/verify";

/**
 * Single-user gate (ADR 0004 / 0011 / 0056). One door: passkeys (WebAuthn).
 * The ceremony is rolled by hand — options routes under /api/auth/webauthn/*,
 * the verdict in lib/webauthn/verify.ts — and fed through this Credentials
 * provider so Auth.js mints the JWT session. No adapter, no database (the
 * built-in WebAuthn provider requires both); the credential record lives in
 * the private blob store. `verifyDoor` returns the owner or null, so a
 * non-null user IS the decision — no allow-list callback needed.
 *
 * GitHub OAuth is gone (ADR 0057): passkeys were proven on every device first,
 * then the fallback was removed. No third party sees the login anymore.
 *
 * Session strategy stays the implicit JWT — session-exists == owner — the
 * invariant every downstream `auth()` gate relies on.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Re-auth is one biometric tap now that passkeys are the sole door — 30d was
  // the pre-passkey window.
  session: { maxAge: 7 * 24 * 60 * 60 },
  providers: [
    Credentials({
      // The client never renders a credentials form (ADR 0022) — the hidden
      // door posts the serialized WebAuthn assertion through signIn().
      id: "webauthn",
      credentials: {},
      authorize: (credentials, request) => verifyDoor(credentials, request),
    }),
  ],
  // No public auth UI (ADR 0022): redirect the built-in sign-in / sign-out /
  // error pages to the lobby, so `/api/auth/signin` can't render a provider
  // page. The hidden door drives the ceremony directly.
  pages: { signIn: "/", signOut: "/", error: "/" },
});
