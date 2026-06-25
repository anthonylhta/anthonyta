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
  // No public auth UI (ADR 0022): redirect the built-in sign-in / sign-out / error
  // pages to the lobby, so `/api/auth/signin` can't render a "Sign in with GitHub"
  // page and a denied (non-owner) login can't land on a stock error screen. The
  // hidden door calls `signIn("github", …)` directly, so it's unaffected. (The
  // providers/session JSON endpoints still respond — this reduces the tell, it
  // doesn't fully erase it.)
  pages: { signIn: "/", signOut: "/", error: "/" },
  callbacks: {
    signIn({ profile }) {
      const login =
        typeof profile?.login === "string" ? profile.login.toLowerCase() : "";
      return OWNER.length > 0 && login === OWNER;
    },
  },
});
