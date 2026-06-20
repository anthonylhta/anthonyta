import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBar } from "@/components/terminal/StatusBar";

export const metadata = {
  title: "riichi · case study",
};

const LIVE = "https://riichi.anthonyta.dev";
const CODE = "https://github.com/anthonylhta/riichi";

export default function RiichiCaseStudy() {
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
          <h1 className="text-lg text-fg">riichi</h1>
          <p className="mt-1 text-sm text-fg/80">
            A browser riichi mahjong game built to <em>teach</em> the game — not
            just host it.
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <a
              href={LIVE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber hover:underline"
            >
              live ↗ riichi.anthonyta.dev
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
              SvelteKit · Neon · Clerk · Rust/WASM · Claude
            </span>
          </div>
        </div>

        <Section title="the problem">
          <p>
            Riichi mahjong is genuinely hard to learn, and good resources are
            scarce. Every client I tried competes on features and polish —
            they&apos;re places to <em>grind games</em>, not to understand them.
            I wanted the tool I wished existed: somewhere you learn <em>why</em>{" "}
            a play is good, not just rack up hands.
          </p>
        </Section>

        <Section title="what I built">
          <ul className="space-y-2">
            <Bullet>
              Solo riichi — one human against three AI, no account to start.{" "}
              <strong className="text-fg">Full, real rules and scoring</strong>:
              riichi (double riichi, ippatsu), tsumo/ron, calls and kans,
              furiten, every dora type, the situational yaku, and
              Mahjong-Soul-accurate game-end (dealer renchan, tobi, the 30k
              target + sudden-death overtime).
            </Bullet>
            <Bullet>
              Two tiers of{" "}
              <strong className="text-fg">deliberately beatable</strong>{" "}
              rule-based AI — learning to read and punish a weaker
              opponent&apos;s mistakes is part of the point.
            </Bullet>
            <Bullet>
              A learning layer: an in-round helper (one grounded discard
              recommendation), a post-game overview, a daily &ldquo;best
              discard&rdquo; puzzle with streaks, and tile-level deal-in review
              that names the exact tile and whether it was avoidable.
            </Bullet>
          </ul>
        </Section>

        <Section title="the interesting part">
          <p className="mb-3">
            A working mahjong game is mostly a correctness problem — the rules
            are notoriously deep. The engineering I&apos;m proudest of is about{" "}
            <em>where the correctness lives</em> and how the teaching stays
            honest:
          </p>
          <ul className="space-y-3">
            <Bullet>
              <strong className="text-fg">
                The model teaches; the libraries are right.
              </strong>{" "}
              Every teaching feature is grounded in provably-correct
              computation, never the model&apos;s guess. Shanten and ukeire come
              from a dedicated efficiency library; yaku and scoring from a
              Rust/WASM library. The Hand of the Day&apos;s{" "}
              <em>correct answer is computed</em> — so it can&apos;t be wrong —
              and Claude only writes the explanation. Keeping the model in its
              lane (narration, not correctness) is the whole design.
            </Bullet>
            <Bullet>
              <strong className="text-fg">A pure, deterministic engine.</strong>{" "}
              One <code className="text-fg/90">GameState</code> value is the
              single source of truth, and the rules are pure{" "}
              <code className="text-fg/90">(state) → state</code> functions with
              no mutation. That makes the full ruleset testable without a
              framework, keeps reasoning sane while three AI turns interleave
              asynchronously, and gives me a deterministic substrate I can
              replay exactly.
            </Bullet>
            <Bullet>
              <strong className="text-fg">
                Replay → a universal log → real analysis.
              </strong>{" "}
              The engine emits a semantic event stream, and a game persists as a
              compact seed-plus-inputs tape that re-derives byte-for-byte. From
              it I export <strong className="text-fg">MJAI</strong> —
              mahjong&apos;s equivalent of chess PGN — so any saved game is
              readable by a reviewer tool like Mortal, or pasted into an LLM.
              The same event stream powers{" "}
              <strong className="text-fg">tile-level review</strong>: it
              rebuilds exactly what you could see at each costly deal-in,
              computes which tiles were <em>actually</em> safe mechanically,
              then asks Claude only for the verdict — avoidable, justified, or
              unlucky.
            </Bullet>
            <Bullet>
              <strong className="text-fg">Knowing what not to build.</strong>{" "}
              The correctness-critical maths is delegated to battle-tested
              libraries, not hand-rolled. The AI opponents are hand-written
              rules, not Claude — they act dozens of times a game, so a model
              would blow the budget for zero teaching value. Claude&apos;s
              budget is reserved for the one thing only it does well:
              explaining.
            </Bullet>
          </ul>
        </Section>

        <Section title="what I'd change next">
          <ul className="space-y-2">
            <Bullet>
              Improvement tracking — win rate, deal-in rate, and hand-efficiency
              trends over time.
            </Bullet>
            <Bullet>
              Cache the tile-review verdicts on the game row — a re-click
              currently re-pays for the analysis.
            </Bullet>
            <Bullet>
              Widen tile-level review beyond deal-ins to riichi declarations and
              big push/fold junctions — same event-stream extractor.
            </Bullet>
          </ul>
        </Section>

        <div className="border-t border-hairline px-4 py-4 text-xs text-muted">
          The model never decides what&apos;s <em>correct</em> here — the engine
          and the libraries do. It just explains. Drawing that line was the
          whole design.
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
