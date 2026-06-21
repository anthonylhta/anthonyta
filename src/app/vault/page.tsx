import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { StatusBar } from "@/components/terminal/StatusBar";
import { getVaultIndex } from "@/lib/connectors/vault";
import { VaultList } from "./VaultList";

export const metadata = { title: "vault" };

// Strictly private: reads the session and the vault on demand.
export const dynamic = "force-dynamic";

export default async function VaultPage() {
  // Owner-only. Guests get a 404 — the page never reveals it exists, and the
  // vault is only read after this gate, so its contents never reach a guest.
  const session = await auth();
  if (!session?.user) notFound();

  const notes = await getVaultIndex();
  const who = session.user.name ?? "anthony";

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">vault</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        {notes.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            No notes. Check that VAULT_FOLDER_ID is set and the folder is shared
            with the service account.
          </p>
        ) : (
          <VaultList notes={notes} />
        )}
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
