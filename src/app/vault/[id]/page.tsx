import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { StatusBar } from "@/components/terminal/StatusBar";
import {
  getVaultImages,
  getVaultIndex,
  getVaultNote,
} from "@/lib/connectors/vault";
import { preprocessNote } from "@/lib/vault";
import { NoteBody } from "./NoteBody";

export const metadata = { title: "vault" };

export const dynamic = "force-dynamic";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Owner-only, and the vault read happens only after the gate.
  const session = await auth();
  if (!session?.user) notFound();

  // Index is cached (fast), and gives the note's modifiedTime so the content
  // read is cache-keyed by it — fresh after an edit, instant on revisit. The image
  // index resolves `![[image]]` embeds to the gated `/vault/img/<id>` route.
  const [index, images] = await Promise.all([
    getVaultIndex(),
    getVaultImages(),
  ]);
  const note = index.find((n) => n.id === id);
  const raw = await getVaultNote(id, note?.modified);
  if (raw == null) notFound();

  const md = preprocessNote(raw, { notes: index, images });
  const who = session.user.name ?? "anthony";
  const dir =
    note && note.path.includes("/")
      ? note.path.slice(0, note.path.lastIndexOf("/"))
      : "";

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

        <div className="border-b border-hairline px-4 pb-3 pt-6">
          <h1 className="text-lg text-fg">{note?.title ?? "note"}</h1>
          {note && (
            <p className="mt-2 text-[11px] tabular-nums text-muted">
              {dir ? `${dir} · ` : ""}
              {note.modified.slice(0, 10)}
            </p>
          )}
        </div>

        <NoteBody md={md} />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
