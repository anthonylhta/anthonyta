import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Single-user gate (ADR 0004 / 0011). GitHub is the identity; only the owner's
 * account is allowed in. Anyone else can click "sign in" but is denied — there
 * are no other accounts and no sign-up. Reads `AUTH_GITHUB_ID/SECRET` +
 * `AUTH_SECRET` from env; the allow-list is `OWNER_GITHUB_LOGIN`.
 */
const OWNER = (process.env.OWNER_GITHUB_LOGIN ?? "").toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [GitHub],
  callbacks: {
    signIn({ profile }) {
      const login =
        typeof profile?.login === "string" ? profile.login.toLowerCase() : "";
      return OWNER.length > 0 && login === OWNER;
    },
  },
});
