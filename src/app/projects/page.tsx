import Link from "next/link";
import { StatusBar } from "@/components/terminal/StatusBar";

// Static page — a scannable index. A `caseStudy` link is added per project only
// once its write-up page exists (e.g. /projects/tone-translator), so nothing 404s.
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
    name: "tone translator",
    desc: "Japanese ⇄ English translation with tone control — pick a politeness register, translate, and check whether your Japanese sounds natural.",
    tech: ["Next.js", "Clerk", "Supabase", "LLM"],
    live: "https://tone.anthonyta.dev",
    code: "https://github.com/anthonylhta/tone-translator",
  },
  {
    name: "webnovelist",
    desc: "An AniList-style web-novel tracker — log what you're reading, rate and review, build a library, and share a public profile.",
    tech: ["Next.js", "Clerk", "Prisma", "Postgres"],
    live: "https://novel.anthonyta.dev",
    code: "https://github.com/anthonylhta/webnovelist",
  },
  {
    name: "riichi",
    desc: "A browser-based riichi mahjong game built to actually teach the game — no account, no download, just play.",
    tech: ["TypeScript", "Next.js"],
    live: "https://riichi.anthonyta.dev",
    code: "https://github.com/anthonylhta/riichi",
  },
  {
    name: "anthonyta.dev",
    desc: "The hub you're on — a dashboard that pulls all of the above in as live, read-only data.",
    tech: ["Next.js", "Auth.js", "Supabase", "Neon"],
    code: "https://github.com/anthonylhta/anthonyta",
    note: "you're here",
  },
];

export default function ProjectsPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

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
