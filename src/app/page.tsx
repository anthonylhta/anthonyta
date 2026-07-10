import { auth } from "@/auth";
import { CommandCenter } from "@/components/CommandCenter";
import { Lobby } from "@/components/Lobby";
import { RecoveryDoor } from "@/components/recovery-door";

/**
 * The adaptive front door (ADR 0004): the public lobby for visitors, the private
 * command center when the owner is logged in. Reading the session makes this
 * route dynamic, so the lobby's connectors fetch per request (fine at this
 * traffic; can be wrapped in a cache later).
 *
 * The recovery door only exists while WEBAUTHN_RECOVERY=1 — a break-glass
 * state the owner enters by flipping the env var and redeploying (lost all
 * passkey devices). Steady state renders no login UI of any kind (ADR 0022).
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) {
    return <CommandCenter userName={session.user.name ?? "anthony"} />;
  }
  return (
    <>
      {process.env.WEBAUTHN_RECOVERY === "1" ? (
        // Constrained to the lobby's column so the break-glass strip doesn't
        // float full-width above the terminal card.
        <div className="mx-auto max-w-3xl">
          <RecoveryDoor />
        </div>
      ) : null}
      <Lobby />
    </>
  );
}
