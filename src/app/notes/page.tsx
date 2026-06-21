import Link from "next/link";
import { StatusBar } from "@/components/terminal/StatusBar";
import { formatNoteDate, notes } from "@/lib/notes";

export const metadata = {
  title: "notes",
};

export default function NotesPage() {
  const sorted = [...notes].sort((a, b) => b.updated.localeCompare(a.updated));

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">notes</span>
          <span aria-hidden />
        </div>

        {/* hero */}
        <div className="border-b border-hairline px-4 py-6">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">notes</span>
          </p>
          <p className="mt-3 text-sm text-fg/80">
            Short notes I keep coming back to — mostly what I&apos;ve learned
            building.
          </p>
        </div>

        {/* list */}
        <div className="divide-y divide-hairline">
          {sorted.map((n) => (
            <Link
              key={n.slug}
              href={`/notes/${n.slug}`}
              className="flex items-baseline gap-4 px-4 py-4 transition-colors hover:bg-surface/30"
            >
              <span className="min-w-0 flex-1">
                <span className="text-sm text-fg">{n.title}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {n.oneLiner}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-muted/60">
                {formatNoteDate(n.updated)}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
