import Link from "next/link";
import { SessionStatusBar } from "@/components/SessionStatusBar";
import { formatNoteDate, notes } from "@/lib/notes";

export const metadata = {
  title: "notes",
};

const PER_PAGE = 10;

/** Page 1 is canonical at /notes — only deeper pages carry the query. */
function pageHref(page: number) {
  return page <= 1 ? "/notes" : `/notes?page=${page}`;
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { page } = await searchParams;
  const sorted = [...notes].sort((a, b) => b.updated.localeCompare(a.updated));

  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const requested = Number.parseInt(typeof page === "string" ? page : "", 10);
  const cur = Number.isNaN(requested)
    ? 1
    : Math.min(Math.max(1, requested), pages);
  const slice = sorted.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

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
          {slice.map((n) => (
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

        {/* pager */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-[11px] text-muted">
            {cur > 1 ? (
              <Link
                href={pageHref(cur - 1)}
                className="transition-colors hover:text-amber"
              >
                ← prev
              </Link>
            ) : (
              <span className="opacity-30">← prev</span>
            )}
            <span className="flex items-center gap-3 tabular-nums">
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) =>
                p === cur ? (
                  <span key={p} className="text-amber">
                    {p}
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={pageHref(p)}
                    className="transition-colors hover:text-amber"
                  >
                    {p}
                  </Link>
                ),
              )}
            </span>
            {cur < pages ? (
              <Link
                href={pageHref(cur + 1)}
                className="transition-colors hover:text-amber"
              >
                next →
              </Link>
            ) : (
              <span className="opacity-30">next →</span>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
