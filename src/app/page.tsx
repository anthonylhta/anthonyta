import Link from "next/link";
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
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const session = await auth();
  if (session?.user) {
    // Owner-only lobby preview (roadmap 59): the owner normally sees the command
    // center at `/`, so they can't see the lobby they're arranging in /system.
    // `?preview=lobby` renders the guest view with an exit banner. A guest with
    // the same param just gets the plain lobby below — the banner is gated on the
    // session, so it never reveals that a private mode exists (ADR 0022).
    const { preview } = await searchParams;
    if (preview === "lobby") {
      return (
        <>
          <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
            <div className="flex items-center justify-between border border-amber/60 bg-amber/10 px-3 py-1.5 text-xs">
              <span className="text-amber">
                previewing: lobby — the guest view
              </span>
              <Link href="/" className="text-amber hover:underline">
                exit preview →
              </Link>
            </div>
          </div>
          <Lobby />
        </>
      );
    }
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
