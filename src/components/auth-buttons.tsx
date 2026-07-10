import { signIn, signOut } from "@/auth";
import { PasskeyDoor } from "@/components/passkey-door";

/**
 * The sign-in door with no visible control — submitted programmatically by
 * the Prompt / KeyShortcut components. The door runs the in-page WebAuthn
 * ceremony (passkey-door.tsx) and falls back to this GitHub server action on
 * any failure while the migration is in flight. Only a verified passkey or
 * the owner's GitHub account passes src/auth.ts, so this is convenience, not
 * access control.
 */
export function AuthForm() {
  return (
    <PasskeyDoor
      fallback={async () => {
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
