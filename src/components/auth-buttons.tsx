import { signIn, signOut } from "@/auth";

/**
 * A GitHub sign-in form with no visible control — submitted programmatically by
 * the Prompt / KeyShortcut components. Only the owner's account passes the auth
 * callback (lib/auth.ts), so this is convenience, not access control.
 */
export function AuthForm() {
  return (
    <form
      id="gh-auth"
      hidden
      action={async () => {
        "use server";
        await signIn("github", { redirectTo: "/" });
      }}
    />
  );
}

export function SignOut({ className = "" }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button type="submit" className={className}>
        sign out
      </button>
    </form>
  );
}
