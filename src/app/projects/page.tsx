import Link from "next/link";
import { SessionStatusBar } from "@/components/SessionStatusBar";

// Static page — a scannable index. A `caseStudy` link is added per project only
// once its write-up page exists (e.g. /projects/ishin), so nothing 404s.
type Project = {
  name: string;
  desc: string;
  tech: string[];
  code: string;
  live?: string;
  caseStudy?: string;
  note?: string;
};

const projects: Project[] = [
  {
    name: "ishin 以心",
    desc: "Japanese ⇄ English communication that lands the way it was meant — pick a register, translate either direction, and check whether your own Japanese sounds native. Now two-sided: a free personal translator and a business review layer (early access).",
    tech: ["Next.js", "Clerk", "Supabase", "Claude"],
    live: "https://ishin.io",
    code: "https://github.com/anthonylhta/ishin",
    caseStudy: "/projects/ishin",
  },
  {
    name: "riichi",
    desc: "A browser riichi mahjong game built to teach the game — full real rules, deliberately beatable AI, and coaching grounded in real efficiency numbers.",
    tech: ["SvelteKit", "Neon", "Rust/WASM", "Claude"],
    live: "https://riichi.anthonyta.dev",
    code: "https://github.com/anthonylhta/riichi",
    caseStudy: "/projects/riichi",
  },
  {
    name: "webnovelist",
    desc: "An AniList-style web-novel tracker — log what you're reading, rate and review, build a library, and share a public profile.",
    tech: ["Next.js", "Clerk", "Prisma", "Postgres"],
    live: "https://novel.anthonyta.dev",
    code: "https://github.com/anthonylhta/webnovelist",
  },
];

export default function ProjectsPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            projects
          </span>
          <span aria-hidden />
        </div>

        {/* hero */}
        <div className="border-b border-hairline px-4 py-6">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">things I&apos;ve built</span>
          </p>
        </div>

        {/* projects */}
        <div className="divide-y divide-hairline">
          {projects.map((p) => (
            <div key={p.name} className="px-4 py-4">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <h2 className="text-fg">{p.name}</h2>
                {p.caseStudy ? (
                  <Link
                    href={p.caseStudy}
                    className="shrink-0 text-xs text-amber hover:underline"
                  >
                    case study →
                  </Link>
                ) : (
                  p.note && (
                    <span className="shrink-0 text-[11px] uppercase tracking-[0.15em] text-muted/70">
                      {p.note}
                    </span>
                  )
                )}
              </div>
              <p className="mb-2 text-sm text-fg/80">{p.desc}</p>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-xs text-muted">{p.tech.join(" · ")}</span>
                <span className="flex shrink-0 items-baseline gap-3 text-xs">
                  {p.live && (
                    <a
                      href={p.live}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber hover:underline"
                    >
                      live ↗
                    </a>
                  )}
                  <a
                    href={p.code}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber hover:underline"
                  >
                    code ↗
                  </a>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
