import Link from "next/link";
import { SessionStatusBar } from "@/components/SessionStatusBar";
import {
  formatNoteDate,
  isNoteTag,
  NOTE_TAGS,
  notes,
  tagCounts,
  type NoteTag,
} from "@/lib/notes";

export const metadata = {
  title: "notes",
};

const PER_PAGE = 10;

/**
 * Canonical URL shape: /notes is page 1 unfiltered; a tag rides as ?tag= and a
 * deeper page as ?page=, tag first so filtered pagination composes
 * (/notes?tag=e2ee&page=2). Page 1 never carries a page param — the same
 * crawlability rule the pager established, now per filter.
 */
function notesHref(page: number, tag?: NoteTag) {
  const params = new URLSearchParams();
  if (tag) params.set("tag", tag);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/notes?${qs}` : "/notes";
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { page, tag: rawTag } = await searchParams;
  // An unknown tag (junk, probing, a renamed tag in an old link) reads as "no
  // filter" — the full index, never an empty page and never an error.
  const tag = isNoteTag(rawTag) ? rawTag : undefined;
  const counts = tagCounts(notes);

  const sorted = [...notes].sort((a, b) => b.updated.localeCompare(a.updated));
  const filtered = tag ? sorted.filter((n) => n.tag === tag) : sorted;

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const requested = Number.parseInt(typeof page === "string" ? page : "", 10);
  const cur = Number.isNaN(requested)
    ? 1
    : Math.min(Math.max(1, requested), pages);
  const slice = filtered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

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

        {/* hero — the prompt echoes an active filter as a command */}
        <div className="border-b border-hairline px-4 py-6">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">
              notes
              {tag && (
                <>
                  {" "}
                  --tag <span className="text-amber">{tag}</span>
                </>
              )}
            </span>
          </p>
          <p className="mt-3 text-sm text-fg/80">
            Short notes I keep coming back to — mostly what I&apos;ve learned
            building.
          </p>
        </div>

        {/* tag filter — server-rendered links, so filtered views are real
            crawlable anchors exactly like the pager's deeper pages */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5 text-[11px]">
          {tag ? (
            <Link
              href={notesHref(1)}
              className="border border-hairline px-2 py-0.5 text-muted transition-colors hover:border-amber hover:text-amber"
            >
              all <span className="opacity-50">{notes.length}</span>
            </Link>
          ) : (
            <span className="border border-amber px-2 py-0.5 text-amber">
              all <span className="opacity-60">{notes.length}</span>
            </span>
          )}
          {NOTE_TAGS.map((t) =>
            t === tag ? (
              <span
                key={t}
                className="border border-amber px-2 py-0.5 text-amber"
              >
                {t} <span className="opacity-60">{counts[t]}</span>
              </span>
            ) : (
              <Link
                key={t}
                href={notesHref(1, t)}
                className="border border-hairline px-2 py-0.5 text-muted transition-colors hover:border-amber hover:text-amber"
              >
                {t} <span className="opacity-50">{counts[t]}</span>
              </Link>
            ),
          )}
        </div>

        {/* list */}
        <div className="divide-y divide-hairline">
          {slice.map((n) => (
            <Link
              key={n.slug}
              href={`/notes/${n.slug}`}
              className="flex items-baseline gap-3 px-4 py-4 transition-colors hover:bg-surface/30"
            >
              <span className="min-w-0 flex-1">
                <span className="text-sm text-fg">{n.title}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {n.oneLiner}
                </span>
              </span>
              <span className="shrink-0 border border-hairline px-1.5 text-[10px] text-muted/60">
                {n.tag}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-muted/60">
                {formatNoteDate(n.updated)}
              </span>
            </Link>
          ))}
        </div>

        {/* pager — composes with the active filter */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-[11px] text-muted">
            {cur > 1 ? (
              <Link
                href={notesHref(cur - 1, tag)}
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
                    href={notesHref(p, tag)}
                    className="transition-colors hover:text-amber"
                  >
                    {p}
                  </Link>
                ),
              )}
            </span>
            {cur < pages ? (
              <Link
                href={notesHref(cur + 1, tag)}
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
