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

// The smaller builds — learning projects and tools, one line each. Same shape,
// listed compactly under the main four rather than dressed up as flagships.
type SmallProject = {
  name: string;
  desc: string;
  tech: string[];
  code: string;
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
  {
    name: "anthonyta.dev",
    desc: "This site — a personal hub and portfolio in a warm-terminal skin. The other projects feed it as live data through read-only connectors (reading progress, the day's mahjong hand, translation stats, the TFT ladder, GitHub activity), and a scheduled routine pushes in a daily markets briefing; the hub itself never calls a model.",
    tech: ["Next.js 16", "Tailwind v4", "Vercel", "Cloudflare"],
    code: "https://github.com/anthonylhta/anthonyta",
    note: "you're on it",
  },
];

const smaller: SmallProject[] = [
  {
    name: "mandosteps",
    desc: "Android companion app that pushes a daily step count from Health Connect to this hub — no cloud API exists for it, so ~150 lines of Kotlin do the push.",
    tech: ["Kotlin", "Health Connect", "WorkManager"],
    code: "https://github.com/anthonylhta/mandosteps",
  },
  {
    name: "chip8-emulator",
    desc: "A CHIP-8 emulator in the browser — the full 35-opcode set on an HTML canvas, no UI framework, public-domain games bundled.",
    tech: ["TypeScript", "Vite", "Canvas"],
    code: "https://github.com/anthonylhta/chip8-emulator",
  },
  {
    name: "homelab",
    desc: "Infra learning sandbox: a one-command Docker Compose stack (app + Postgres + Prometheus + Grafana) with the app's metrics live in a dashboard, on the way to k3s.",
    tech: ["Docker Compose", "Prometheus", "Grafana"],
    code: "https://github.com/anthonylhta/homelab",
  },
  {
    name: "local-rag",
    desc: "A from-scratch, fully-offline RAG pipeline — local embeddings, hand-rolled numpy cosine similarity, generation through Ollama; sources shown with every answer.",
    tech: ["Python", "sentence-transformers", "Ollama"],
    code: "https://github.com/anthonylhta/local-rag",
  },
  {
    name: "ledger",
    desc: "A local-file finance and portfolio tracker CLI, written to learn Rust's ownership, borrowing and Result fundamentals — the source explains each decision.",
    tech: ["Rust"],
    code: "https://github.com/anthonylhta/ledger",
  },
  {
    name: "mylang",
    desc: "A tiny scripting language with a tree-walking interpreter: lexer → parser → AST → evaluator, enough to run FizzBuzz and a recursive Fibonacci.",
    tech: ["TypeScript"],
    code: "https://github.com/anthonylhta/mylang",
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

        {/* smaller builds — compact rows */}
        <div className="border-t border-hairline px-4 py-2 text-xs">
          <span className="uppercase tracking-[0.2em] text-muted">
            smaller builds
          </span>
        </div>
        <div className="divide-y divide-hairline/60">
          {smaller.map((p) => (
            <div key={p.name} className="px-4 py-3">
              <div className="mb-0.5 flex items-baseline justify-between gap-3">
                <h3 className="text-sm text-fg">{p.name}</h3>
                <a
                  href={p.code}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-amber hover:underline"
                >
                  code ↗
                </a>
              </div>
              <p className="mb-1 text-xs text-fg/75">{p.desc}</p>
              <span className="text-[11px] text-muted">
                {p.tech.join(" · ")}
              </span>
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
