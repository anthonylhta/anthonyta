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
      <GutterOrnament />
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

/**
 * Desktop gutter ornament (ADR 0146; ADR 0027: ornament, not words) — one
 * cloud curl per gutter whose tail falls as a single ink trail. xl-only so
 * tablets never see it clipped; fixed in the viewport gutters (outside the
 * max-w-3xl column, so it never overlaps content); near-threshold ink,
 * nothing keyed to owner state.
 */
function GutterOrnament() {
  const gutter =
    "pointer-events-none fixed inset-y-0 hidden w-[calc(50vw-24rem)] items-center justify-center xl:flex";
  return (
    <>
      <div aria-hidden="true" className={`${gutter} left-0 text-fg`}>
        <svg
          width="200"
          height="660"
          viewBox="0 0 200 660"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        >
          <defs>
            <linearGradient id="novels-orn-l" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.07" />
              <stop offset="0.7" stopColor="currentColor" stopOpacity="0.045" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M140 96 C 140 70 121 55 98 55 C 75 55 58 72 58 93 C 58 112 73 125 92 125 C 107 125 117 114 117 101 C 117 91 109 85 101 85 C 94 85 90 90 90 96"
            opacity="0.095"
            strokeWidth="1.6"
          />
          <path
            d="M140 96 C 150 140 132 180 118 230 C 102 288 122 350 110 420 C 100 478 114 530 106 596"
            stroke="url(#novels-orn-l)"
            strokeWidth="2.4"
          />
        </svg>
      </div>
      <div aria-hidden="true" className={`${gutter} right-0 text-fg`}>
        <svg
          width="200"
          height="660"
          viewBox="0 0 200 660"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        >
          <defs>
            <linearGradient id="novels-orn-r" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.07" />
              <stop offset="0.7" stopColor="currentColor" stopOpacity="0.045" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g transform="translate(200,0) scale(-1,1)">
            <path
              d="M140 150 C 140 124 121 109 98 109 C 75 109 58 126 58 147 C 58 166 73 179 92 179 C 107 179 117 168 117 155 C 117 145 109 139 101 139 C 94 139 90 144 90 150"
              opacity="0.095"
              strokeWidth="1.6"
            />
          </g>
          <path
            d="M60 150 C 50 194 68 234 82 284 C 98 342 78 404 90 474 C 100 532 86 584 94 650"
            stroke="url(#novels-orn-r)"
            strokeWidth="2.4"
          />
        </svg>
      </div>
    </>
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
