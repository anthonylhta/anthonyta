import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { SessionStatusBar } from "@/components/SessionStatusBar";

export const metadata = {
  title: "uses",
};

const drivers = [
  {
    label: "tone",
    href: "https://tone.anthonyta.dev",
    desc: "texting Japanese friends",
  },
  {
    label: "riichi",
    href: "https://riichi.anthonyta.dev",
    desc: "learning mahjong",
  },
  {
    label: "novel",
    href: "https://novel.anthonyta.dev",
    desc: "tracking what I read",
  },
];

export default async function UsesPage() {
  // Pulled from the public face for now (owner call, 2026-07-14) — guests get
  // the same 404 wall as every private page; the content stays reachable
  // signed-in until it's reworked or reinstated.
  const session = await auth();
  if (!session?.user) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">uses</span>
          <span aria-hidden />
        </div>

        {/* hero */}
        <div className="border-b border-hairline px-4 py-6">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">the setup</span>
          </p>
          <p className="mt-3 text-sm text-fg/80">
            The tools I actually build with. Velocity comes from AI; the
            judgment is mine.
          </p>
        </div>

        <Section title="editor & terminal">
          <Row k="editor">
            <span className="text-fg">Claude Code</span> — agentic CLI; custom
            hooks, a CLAUDE.md context file, /code-review in the loop
          </Row>
          <Row k="shell">
            WSL / Ubuntu, <span className="text-fg">git</span> + the{" "}
            <span className="text-fg">gh</span> CLI
          </Row>
          <Row k="ui scaffold">
            v0 for a first-pass component, refined in Claude Code
          </Row>
        </Section>

        <Section title="languages & frameworks">
          <p className="text-sm text-fg/80">
            <span className="text-fg">TypeScript</span> · Python &nbsp;·&nbsp;{" "}
            <span className="text-fg">Next.js 16</span> / React 19 ·{" "}
            <span className="text-fg">SvelteKit</span> · Tailwind
          </p>
        </Section>

        <Section title="ai — in the products">
          <Row k="models">
            <span className="text-fg">Claude API</span> — Haiku on the hot
            paths, Sonnet for quality checks and as an LLM-judge in evals
          </Row>
          <Row k="how">
            the model stays in its lane — it explains; the correctness is
            computed
          </Row>
        </Section>

        <Section title="data · auth · hosting">
          <Row k="data">Supabase / Postgres · Neon · Prisma · Drizzle</Row>
          <Row k="auth">Clerk · Auth.js</Row>
          <Row k="hosting">
            <span className="text-fg">Vercel</span> (incl. cron) · Cloudflare
            DNS · GitHub Actions CI
          </Row>
        </Section>

        <Section title="workflow">
          <p className="text-sm text-fg/80">
            <span className="text-fg">Obsidian</span> for notes · an ADR + bug
            decision-log on every project · vitest · eslint + prettier
          </p>
        </Section>

        <Section title="daily drivers — things I built because I use them">
          <div className="space-y-2">
            {drivers.map((d) => (
              <div key={d.label} className="flex gap-4 text-sm">
                <a
                  href={d.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-24 shrink-0 text-amber hover:underline"
                >
                  {d.label} ↗
                </a>
                <span className="text-fg/80">{d.desc}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-hairline px-4 py-5">
      <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-1 text-sm">
      <span className="w-24 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
        {k}
      </span>
      <span className="text-fg/80">{children}</span>
    </div>
  );
}
