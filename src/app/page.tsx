import { auth } from "@/auth";
import { CommandCenter } from "@/components/CommandCenter";
import { Lobby } from "@/components/Lobby";

/**
 * The adaptive front door (ADR 0004): the public lobby for visitors, the private
 * command center when the owner is logged in. Reading the session makes this
 * route dynamic, so the lobby's connectors fetch per request (fine at this
 * traffic; can be wrapped in a cache later).
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) {
    return <CommandCenter userName={session.user.name ?? "anthony"} />;
  }
  return <Lobby />;
}
