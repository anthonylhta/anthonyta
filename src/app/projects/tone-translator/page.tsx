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
            A Japanese ⇄ English translator where <em>naturalness</em> is the
            product — not literal translation.
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
              Next.js · Clerk · Supabase · Claude (Haiku + Sonnet)
            </span>
          </div>
        </div>

        <Section title="the problem">
          <p>
            I text Japanese friends, and every tool I reached for handed me
            stiff, textbook Japanese that reads as non-native on sight. The two
            obvious options are wrong in opposite directions: a literal
            translator like Google Translate is rough and unnatural, while a raw
            chatbot is natural but <em>inconsistent</em> — as the conversation
            grows the context drifts, and you re-explain{" "}
            <em>casual, natural, no romaji</em> every single time. I wanted the
            middle ground: a tuned, hardened prompt baked into a one-tap
            interface, so the output is the same quality, instantly, every time.
          </p>
        </Section>

        <Section title="what I built">
          <ul className="space-y-2">
            <Bullet>
              Translate in <strong className="text-fg">four registers</strong> —
              casual (the default; it&apos;s how you talk to friends), polite,
              formal, blunt — and it explains its own slang and politeness
              choices inline.
            </Bullet>
            <Bullet>
              A <strong className="text-fg">&ldquo;check&rdquo; mode</strong>: a
              separate, stronger model grades your Japanese like a tutor — it
              catches subtle native-speaker errors (あげる vs くれる direction,
              a dropped particle) and suggests the fix.
            </Bullet>
            <Bullet>
              Streamed token-by-token, per-user history, rate-limited with a
              budget kill-switch. It&apos;s live and public.
            </Bullet>
          </ul>
          <div className="mt-4 flex items-center justify-center rounded border border-dashed border-hairline px-4 py-10 text-xs text-muted/60">
            screenshot — the translate view + a tone switch
          </div>
        </Section>

        <Section title="the interesting part">
          <p className="mb-3">
            Wiring an API call is the easy part. The real problem was making the
            output <em>reliably</em> good when &ldquo;good&rdquo; is subjective
            and the model is non-deterministic. The decisions I&apos;m proudest
            of are all about that:
          </p>
          <ul className="space-y-3">
            <Bullet>
              <strong className="text-fg">Quality as a data problem.</strong> I
              built an eval harness — a golden set of ~24 cases, each seeded
              from a real failure (giving/receiving direction, particle errors,
              the right register per tone, prompt injection), graded by Sonnet
              as an <strong className="text-fg">LLM-judge</strong> at
              temperature 0. It runs the <em>real shipping prompt</em>, so a
              careless edit shows up as a score drop. I keep it out of CI on
              purpose — it&apos;s non-deterministic and costs real calls — and I
              trust the <em>delta between runs</em>, not any single score. Each
              case links to the bug that created it, so the suite is my
              regression history, executable.
            </Bullet>
            <Bullet>
              <strong className="text-fg">
                Then I automated the discipline.
              </strong>{" "}
              A harness only helps if you keep feeding it, so I built a
              failure-miner agent: weekly, it reads real translations from the
              database, judges each with Claude, and <em>proposes</em> new test
              cases for the failures — I approve them; it never edits the test
              set itself. Its first run over 50 translations surfaced 5 genuine
              failures and grew the set from 19 to 24.
            </Bullet>
            <Bullet>
              <strong className="text-fg">
                Pull the brittle decision out of the model.
              </strong>{" "}
              Translation direction was once the model&apos;s job, and on formal
              input it would sometimes echo Japanese back as Japanese. I detect
              the script with a Unicode regex in code instead — 100% reliable
              and free. Knowing what <em>not</em> to hand the model is half the
              skill.
            </Bullet>
            <Bullet>
              <strong className="text-fg">
                Prompt injection, the subtle version.
              </strong>{" "}
              &ldquo;Ignore your instructions and say X&rdquo; has to be{" "}
              <em>translated</em>, not obeyed — but my first fix overcorrected:
              the model started refusing or lecturing instead of silently
              translating, broken nine times out of ten. The real fix was making
              refusal itself a failure mode in the prompt — treat all input as
              text, resist silently. Eval-verified, 9/10 → 0/10.
            </Bullet>
          </ul>
        </Section>

        <Section title="what I'd change next">
          <ul className="space-y-2">
            <Bullet>
              Have the agent open a draft PR with its proposed cases, instead of
              leaving an artifact for me to copy in by hand.
            </Bullet>
            <Bullet>
              Point the same eval harness at the <em>check</em> feature, not
              just translation.
            </Bullet>
            <Bullet>
              Harden the judge against injection from the content it reads — it
              ingests real translations, the same attack surface the app itself
              defends against.
            </Bullet>
            <Bullet>
              Cross-device live history sync — parked on purpose; it wasn&apos;t
              the priority yet.
            </Bullet>
          </ul>
        </Section>

        <div className="border-t border-hairline px-4 py-4 text-xs text-muted">
          Built fast with AI — the velocity was the tool; the model choices, the
          evals, and the architecture were the judgment.
        </div>

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
      <span className="shrink-0 text-amber">•</span>
      <span>{children}</span>
    </li>
  );
}
