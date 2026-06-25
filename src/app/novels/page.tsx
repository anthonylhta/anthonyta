import Link from "next/link";
import { SessionStatusBar } from "@/components/SessionStatusBar";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { matchNovel, novels, type Novel } from "@/lib/novels";

export const metadata = { title: "novels" };

// The live % comes from the webnovel connector; render on demand so it's current.
export const dynamic = "force-dynamic";

const zh = "font-[family-name:var(--font-zh)]";
const RANK: Record<Novel["status"], number> = {
  reading: 0,
  paused: 1,
  finished: 2,
};

export default async function NovelsPage() {
  const reads = await getCurrentlyReading();

  // Enrich curated novels with a live progress % (the tracker never adds rows —
  // it only fills in the percent on novels that are already on the list).
  const pctByTitle = new Map<string, number | null>();
  for (const r of reads) {
    const n = matchNovel(r.title);
    if (n) {
      pctByTitle.set(
        n.en,
        r.total ? Math.round((r.chapter / r.total) * 100) : null,
      );
    }
  }

  const ordered = [...novels].sort((a, b) => RANK[a.status] - RANK[b.status]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">novels</span>
          <span aria-hidden />
        </div>

        {/* hero — about reading novels in general, not one genre */}
        <div className="border-b border-hairline px-4 py-6">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">what I read</span>
          </p>
          <p className="mt-3 text-sm text-fg/80">
            I read a lot of long-running web serials — the kind with deep,
            rule-driven worlds you can disappear into for months. Lately
            that&apos;s mostly Chinese cultivation (xianxia). A few I&apos;d
            actually recommend, and why.
          </p>
        </div>

        {/* the list — the curated source of truth */}
        <div className="px-4 py-5">
          <div className="space-y-6">
            {ordered.map((n) => (
              <NovelRow key={n.en} n={n} pct={pctByTitle.get(n.en) ?? null} />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}

function NovelRow({ n, pct }: { n: Novel; pct: number | null }) {
  const status =
    n.status === "reading" && pct != null ? `reading · ${pct}%` : n.status;
  return (
    <article>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-fg">{n.en}</h3>
        {n.zh && (
          <span lang="zh" className={`${zh} text-sm text-muted`}>
            {n.zh}
          </span>
        )}
        {n.link && (
          <a
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber hover:underline"
          >
            ↗
          </a>
        )}
        <span className="ml-auto text-[11px] uppercase tracking-[0.12em] text-muted/70">
          {status}
        </span>
      </div>
      {n.author && <p className="mt-0.5 text-xs text-muted/70">{n.author}</p>}
      <p className="mt-1.5 text-sm text-fg/80">{n.take}</p>
    </article>
  );
}
