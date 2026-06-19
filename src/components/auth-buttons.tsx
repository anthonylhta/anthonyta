import { signIn, signOut } from "@/auth";

/** Sign in with GitHub (server action). Only the owner's account is allowed in. */
export function SignIn({ className = "" }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("github", { redirectTo: "/" });
      }}
    >
      <button type="submit" className={className}>
        sign in
      </button>
    </form>
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
