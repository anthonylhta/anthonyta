import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { StatusBar } from "@/components/terminal/StatusBar";
import {
  getVaultIndex,
  getVaultNote,
  type VaultNote,
} from "@/lib/connectors/vault";
import { NoteBody } from "./NoteBody";

export const metadata = { title: "vault" };

export const dynamic = "force-dynamic";

/** Strip YAML frontmatter, turn Obsidian `[[wikilinks]]` into in-vault links, and
 *  replace `![[embeds]]` with a placeholder (images come later). */
function preprocess(raw: string, index: VaultNote[]): string {
  const byTitle = new Map<string, string>();
  for (const n of index) byTitle.set(n.title.toLowerCase(), n.id);

  let md = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  md = md.replace(
    /!\[\[([^\]]+)\]\]/g,
    (_m, name) => `*[embed: ${String(name).trim()}]*`,
  );
  md = md.replace(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
    (_m, name, alias) => {
      const id = byTitle.get(String(name).trim().toLowerCase());
      const label = String(alias ?? name).trim();
      return id ? `[${label}](/vault/${id})` : label;
    },
  );
  return md;
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Owner-only, and the vault read happens only after the gate.
  const session = await auth();
  if (!session?.user) notFound();

  const [raw, index] = await Promise.all([getVaultNote(id), getVaultIndex()]);
  if (raw == null) notFound();

  const note = index.find((n) => n.id === id);
  const md = preprocess(raw, index);
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

        <div className="border-b border-hairline px-4 pb-3 pt-6">
          <h1 className="text-lg text-fg">{note?.title ?? "note"}</h1>
          {note && (
            <p className="mt-2 text-[11px] tabular-nums text-muted">
              {note.path} · {note.modified.slice(0, 10)}
            </p>
          )}
        </div>

        <NoteBody md={md} />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
