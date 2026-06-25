import { auth } from "@/auth";
import { StatusBar } from "@/components/terminal/StatusBar";

/**
 * StatusBar that reflects the real session — the owner's handle (green dot) when
 * signed in, else "guest" (ADR 0004). Reading the session makes any page that
 * renders it dynamic. The adaptive home (lobby vs command center) and the few
 * pages that already read the session pass `user` to <StatusBar> directly.
 */
export async function SessionStatusBar() {
  const session = await auth();
  const user = session?.user ? (session.user.name ?? "anthony") : "guest";
  return <StatusBar user={user} />;
}
