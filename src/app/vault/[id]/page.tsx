import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { StatusBar } from "@/components/terminal/StatusBar";
import { r2Enabled } from "@/lib/r2";
import { NoteReader } from "./NoteReader";

export const metadata = { title: "vault" };

export const dynamic = "force-dynamic";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Owner-only, and the gate is all the server does — the note is now an encrypted
  // blob the browser fetches and decrypts in place (ADR: E2EE vault). No Drive read,
  // no plaintext title, nothing sealed ever transits the server as cleartext.
  const session = await auth();
  if (!session?.user) notFound();

  const who = session.user.name ?? "anthony";

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/vault" className="text-muted hover:text-amber">
            ← vault
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">note</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        <NoteReader id={id} offline={!r2Enabled()} />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
