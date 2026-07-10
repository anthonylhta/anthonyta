import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { verifyDoor } from "@/lib/webauthn/verify";

/**
 * Single-user gate (ADR 0004 / 0011). Two doors, one owner:
 *
 *  - Passkeys (WebAuthn): the ceremony is rolled by hand — options routes
 *    under /api/auth/webauthn/*, the verdict in lib/webauthn/verify.ts — and
 *    fed through this Credentials provider so Auth.js still mints the same
 *    JWT session. No adapter, no database (the built-in WebAuthn provider
 *    requires both); the credential record lives in the private blob store.
 *  - GitHub OAuth: the transition fallback, allow-listed to the owner's
 *    account via `OWNER_GITHUB_LOGIN`. Removed once passkeys are verified on
 *    every device.
 *
 * Session strategy stays the implicit JWT — session-exists == owner — so
 * every downstream `auth()` gate is untouched by the provider swap.
 */
const OWNER = (process.env.OWNER_GITHUB_LOGIN ?? "").toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub,
    Credentials({
      // The client never renders a credentials form (ADR 0022) — the hidden
      // door posts the serialized WebAuthn assertion through signIn().
      id: "webauthn",
      credentials: {},
      authorize: (credentials, request) => verifyDoor(credentials, request),
    }),
  ],
  // No public auth UI (ADR 0022): redirect the built-in sign-in / sign-out / error
  // pages to the lobby, so `/api/auth/signin` can't render a provider page and a
  // denied login can't land on a stock error screen. The hidden door drives both
  // providers directly, so it's unaffected. (The providers/session JSON endpoints
  // still respond — this reduces the tell, it doesn't fully erase it.)
  pages: { signIn: "/", signOut: "/", error: "/" },
  callbacks: {
    signIn({ account, profile }) {
      // Passkey sign-ins are fully verified inside authorize(); a non-null
      // user IS the decision. Only GitHub needs the owner allow-list.
      if (account?.provider === "webauthn") return true;
      const login =
        typeof profile?.login === "string" ? profile.login.toLowerCase() : "";
      return OWNER.length > 0 && login === OWNER;
    },
  },
});
