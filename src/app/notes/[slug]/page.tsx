import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionStatusBar } from "@/components/SessionStatusBar";
import { formatNoteDate, getNote, notes } from "@/lib/notes";

export function generateStaticParams() {
  return notes.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const note = getNote(slug);
  return { title: note ? `${note.title} · notes` : "notes" };
}

export default async function NotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const note = getNote(slug);
  if (!note) notFound();

  const related = (note.related ?? [])
    .map(getNote)
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/notes" className="text-muted hover:text-amber">
            ← notes
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">note</span>
          <span aria-hidden />
        </div>

        {/* header */}
        <div className="border-b border-hairline px-4 pb-3 pt-6">
          <h1 className="text-lg text-fg">{note.title}</h1>
          <p className="mt-2 text-[11px] text-muted">
            updated {formatNoteDate(note.updated)}
          </p>
        </div>

        {/* body — sans for readability; child selectors style the JSX */}
        <div className="px-4 py-5 font-[family-name:var(--font-geist-sans)] text-[15px] leading-relaxed text-fg/85 [&_em]:text-fg [&_p]:mb-3.5 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-fg">
          {note.body}
        </div>

        {related.length > 0 && (
          <div className="border-t border-hairline px-4 py-3 text-xs text-muted">
            related →{" "}
            {related.map((r, i) => (
              <span key={r.slug}>
                {i > 0 && " · "}
                <Link href={`/notes/${r.slug}`} className="text-amber hover:underline">
                  {r.title}
                </Link>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
