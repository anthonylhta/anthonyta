import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBar } from "@/components/terminal/StatusBar";

export const metadata = {
  title: "tone translator · case study",
};

const LIVE = "https://tone.anthonyta.dev";
const CODE = "https://github.com/anthonylhta/tone-translator";

export default function ToneTranslatorCaseStudy() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/projects" className="text-muted hover:text-amber">
            ← projects
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            case study
          </span>
          <span aria-hidden />
        </div>

        {/* hero */}
        <div className="border-b border-hairline px-4 py-6">
          <h1 className="text-lg text-fg">tone translator</h1>
          <p className="mt-1 text-sm text-fg/80">
            Japanese ⇄ English translation with tone control.
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <a
              href={LIVE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber hover:underline"
            >
              live ↗ tone.anthonyta.dev
            </a>
            <a
              href={CODE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber hover:underline"
            >
              code ↗
            </a>
            <span className="text-muted">
              Next.js · React 19 · Clerk · Supabase · Claude
            </span>
          </div>
        </div>

        <Section title="the problem">
          <p>
            Machine translation hands you one register — and in Japanese,
            usually the wrong one. Politeness there isn&apos;t decoration;
            it&apos;s grammar, and picking the wrong level is socially loud. A
            learner needs two things a general translator won&apos;t give: to{" "}
            <em>see</em> how one sentence shifts across registers, and to check
            whether their own Japanese actually sounds natural.
          </p>
        </Section>

        <Section title="what I built">
          <ul className="space-y-2">
            <Bullet>
              Translate any sentence in{" "}
              <strong className="text-fg">four registers</strong> — casual,
              polite, formal, blunt — each with a one-line note on what changed
              and why.
            </Bullet>
            <Bullet>
              A <strong className="text-fg">&ldquo;check&rdquo; mode</strong>{" "}
              that grades your own Japanese and corrects it — a feedback loop,
              not just a dictionary.
            </Bullet>
            <Bullet>
              Every translation is saved per account — a few hundred and
              counting — which also feeds the live language stats on this hub.
            </Bullet>
          </ul>
          <div className="mt-4 flex items-center justify-center rounded border border-dashed border-hairline px-4 py-10 text-xs text-muted/60">
            screenshot — the four-register output
          </div>
        </Section>

        <Section title="the interesting part">
          <p>
            Tone is a <strong className="text-fg">first-class input</strong>,
            not a phrase bolted onto a prompt. Each request asks Claude for the
            translation <em>and</em> a short, structured explanation keyed to
            the chosen register, so the UI can show the <em>why</em>, not just
            the output. The &ldquo;check&rdquo; mode is a separate task with its
            own shape — grade, then correct.
          </p>
          {/* TODO(anthony): replace this callout with the real implementation story. */}
          <Todo>
            Your detail here — how the per-register prompt is actually built,
            and what was hardest to keep consistent run-to-run.
          </Todo>
        </Section>

        <Section title="what I'd change">
          <ul className="space-y-2">
            <Bullet>
              A small <strong className="text-fg">eval set per register</strong>
              , to catch tone drift automatically instead of by feel.
            </Bullet>
            <Bullet>
              Cache the common phrases — a lot of requests repeat.
            </Bullet>
          </ul>
          {/* TODO(anthony): your real next steps. */}
          <Todo>Your real next steps.</Todo>
        </Section>

        <div className="flex items-center justify-center gap-4 border-t border-hairline px-4 py-3 text-xs">
          <Link href="/projects" className="text-muted hover:text-amber">
            ← projects
          </Link>
          <span className="text-hairline">·</span>
          <a
            href={LIVE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber hover:underline"
          >
            live ↗
          </a>
          <span className="text-hairline">·</span>
          <a
            href={CODE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber hover:underline"
          >
            code ↗
          </a>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-hairline px-4 py-5 text-sm leading-relaxed text-fg/90">
      <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-amber">•</span>
      <span>{children}</span>
    </li>
  );
}

/** A clearly-marked placeholder for the sections only Anthony can write. */
function Todo({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded border border-dashed border-hairline px-3 py-3 text-xs text-muted/70">
      ✎ {children}
    </div>
  );
}
