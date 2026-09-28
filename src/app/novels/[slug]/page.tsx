import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { SessionStatusBar } from "@/components/SessionStatusBar";
import { formatNoteDate } from "@/lib/notes";
import { novels } from "@/lib/novels";
import { getReview, reviews } from "@/lib/reviews";

export function generateStaticParams() {
  return reviews.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const review = getReview(slug);
  return { title: review ? `${review.novel} · novels` : "novels" };
}

const zh = "font-[family-name:var(--font-zh)]";

/** The jump row's short word per section id. */
const SHORT: Record<string, string> = {
  verdict: "verdict",
  pitch: "pitch",
  about: "about",
  works: "works",
  doesnt: "doesn't",
  who: "who",
  stuck: "stuck",
  practical: "practical",
  reread: "reread",
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const review = getReview(slug);
  if (!review) notFound();
  const novel = novels.find((n) => n.en === review.novel);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/novels" className="text-muted hover:text-amber">
            ← novels
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">review</span>
          <span aria-hidden />
        </div>

        {/* header */}
        <div className="border-b border-hairline px-4 pb-3 pt-6">
          <h1 className="text-lg text-fg">{review.novel}</h1>
          {novel?.zh && (
            <p lang="zh" className={`${zh} text-sm text-muted`}>
              {novel.zh}
            </p>
          )}
          {novel?.author && (
            <p className="text-xs text-muted/70">{novel.author}</p>
          )}
          <p className="mt-2 text-[11px] text-muted">
            {review.read} · {review.caughtUp} · {review.via} ·{" "}
            {formatNoteDate(review.date)}
          </p>
        </div>

        {/* jumps */}
        <nav
          aria-label="sections"
          className="flex flex-wrap gap-x-2 gap-y-1 border-b border-hairline px-4 py-2 text-[11px] text-muted"
        >
          {review.sections.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 && <span aria-hidden>·</span>}
              <a href={`#${s.id}`} className="hover:text-amber">
                {SHORT[s.id] ?? s.title}
              </a>
            </Fragment>
          ))}
        </nav>

        {review.sections.map((s, i) => (
          <section
            key={s.id}
            id={s.id}
            className={`px-4 py-5 ${i > 0 ? "border-t border-hairline" : ""}`}
          >
            <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted">
              <span className="text-amber">&gt;</span> {s.title}
            </h2>
            {/* body — sans for readability, the /notes/[slug] language */}
            <div className="mt-3 font-[family-name:var(--font-geist-sans)] text-[15px] leading-relaxed text-fg/85 [&_li]:mb-2 [&_li:last-child]:mb-0 [&_li]:marker:text-muted/60 [&_p]:mb-3.5 [&_p:last-child]:mb-0 [&_ul]:mb-3.5 [&_ul:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5">
              {s.body}
            </div>
          </section>
        ))}

        <div className="border-t border-hairline px-4 py-3 text-xs text-muted">
          revisions → {review.read} {review.date}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
