import { signOut } from "@/auth";
import { PasskeyDoor } from "@/components/passkey-door";

/**
 * The sign-in door with no visible control — submitted programmatically by
 * the Prompt / KeyShortcut components. The door runs the in-page WebAuthn
 * ceremony (passkey-door.tsx); a verified passkey is the only way in (ADR 0057
 * removed the GitHub fallback), and only `verifyDoor` in src/auth.ts grants a
 * session, so this component is convenience, not access control.
 */
export function AuthForm() {
  return <PasskeyDoor />;
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
