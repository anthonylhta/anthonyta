import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { StatusBar } from "@/components/terminal/StatusBar";
import { listInbox } from "@/lib/inbox";
import { FilesInbox } from "./FilesInbox";

export const metadata = { title: "files" };

// Strictly private: reads the session and the inbox on demand.
export const dynamic = "force-dynamic";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Owner-only. Guests get a 404 — the page never reveals it exists, and the
  // inbox is only read after this gate, so its contents never reach a guest.
  const session = await auth();
  if (!session?.user) notFound();

  const { share, shared } = await searchParams;
  const { files, offline } = await listInbox();
  const who = session.user.name ?? "anthony";

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">files</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        {share === "failed" && (
          <p className="border-b border-hairline px-4 py-2 text-xs text-down">
            share failed — file too large or store offline
          </p>
        )}

        {offline && (
          <p className="border-b border-hairline px-4 py-2 text-xs text-muted">
            store offline — set the R2_* env vars
          </p>
        )}

        <FilesInbox files={files} offline={offline} shared={shared === "1"} />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
