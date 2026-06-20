import type { ReactNode } from "react";

/**
 * Short evergreen notes — mostly lessons distilled from the decision logs of my
 * projects (tone-translator, riichi, webnovelist, this hub). The `/notes` page
 * renders these; add one by appending to the array. Bodies are plain JSX
 * (paragraphs / strong / em); styling is applied by the page wrapper.
 */
export type Note = {
  slug: string;
  title: string;
  oneLiner: string;
  /** ISO date (YYYY-MM-DD) — drives ordering + the "updated" stamp */
  updated: string;
  body: ReactNode;
  /** slugs of related notes */
  related?: string[];
};

export const notes: Note[] = [
  {
    slug: "keep-the-model-in-its-lane",
    title: "keep the model in its lane",
    oneLiner:
      "Let the model do the fuzzy part; compute everything that can be computed.",
    updated: "2026-06-21",
    related: ["evals-turn-a-demo-into-a-product", "a-prompt-is-a-vote"],
    body: (
      <>
        <p>
          Across two projects I kept arriving at the same rule:{" "}
          <strong>
            let the model do the part only a model can, and compute everything
            that can be computed.
          </strong>{" "}
          The interesting engineering isn’t the API call — it’s drawing that
          line.
        </p>
        <p>
          In the <strong>tone translator</strong>, the model translates and
          explains register nuance — genuinely fuzzy, linguistic work. But
          translation <em>direction</em> (JP→EN vs EN→JP) isn’t fuzzy: I detect
          the script with a Unicode regex in code, because a model asked to
          “figure out the direction” will occasionally echo Japanese back as
          Japanese. And quality isn’t a vibe — a stronger model grades outputs
          against a rubric, and I trust the <em>delta between runs</em>, not any
          single score.
        </p>
        <p>
          In <strong>riichi</strong> the rule is sharper still. The teaching
          features are powered by Claude, but the{" "}
          <strong>correct answer is computed</strong> — shanten and scoring come
          from battle-tested libraries, so the Hand-of-the-Day answer{" "}
          <em>can’t be wrong</em>; the model only writes the explanation. The AI
          opponents aren’t a model at all — they’re hand-written rules, because
          they act dozens of times a game and a model there would blow the
          budget for zero teaching value.
        </p>
        <p>
          The throughline:{" "}
          <strong>
            a model is a narrator and a fuzzy-judgment engine, not a source of
            truth.
          </strong>{" "}
          When something is computable, compute it — it’s cheaper, faster,
          deterministic, and testable. Reserve the model for the part that’s
          actually fuzzy. Knowing <em>what not to hand the model</em> is half of
          building with one.
        </p>
      </>
    ),
  },
  {
    slug: "a-prompt-is-a-vote",
    title: "a prompt is a vote, not a checklist",
    oneLiner: "Why a soft “…unless…” clause loses to the paragraph around it.",
    updated: "2026-06-15",
    related: ["keep-the-model-in-its-lane", "evals-turn-a-demo-into-a-product"],
    body: (
      <>
        <p>
          A system prompt isn’t a list of rules the model dutifully ticks off.
          It’s closer to a <strong>vote among competing instructions</strong> —
          and a single soft mention loses to the paragraph leaning the other
          way.
        </p>
        <p>
          I hit this translating formal Japanese to English. The prompt pushed
          hard toward natural, casual English, with one buried aside: “…unless
          the Japanese is clearly formal.” For keigo input, the casual pull
          out-voted that lone clause every time — deferential business Japanese
          came out as breezy texting English. The instruction was technically
          present; it just lost the vote.
        </p>
        <p>
          The fix wasn’t adding more caveats. It was{" "}
          <strong>promoting the behaviour to a first-class rule</strong> with
          concrete recognition cues — naming the actual keigo markers
          (です／ます, 恐縮ですが, ～いただけますでしょうか) so the model
          couldn’t miss them. When a behaviour matters, make it load-bearing,
          not an “…unless…” tucked into a sentence pushing the other way.
        </p>
      </>
    ),
  },
  {
    slug: "evals-turn-a-demo-into-a-product",
    title: "evals turn a demo into a product",
    oneLiner:
      "A golden set, an LLM judge, and trusting the delta — not the score.",
    updated: "2026-06-12",
    related: ["keep-the-model-in-its-lane", "a-prompt-is-a-vote"],
    body: (
      <>
        <p>
          Most LLM apps ship with zero evals — quality is judged by
          spot-checking, which is vibes. That bit me twice: a failure rate I
          claimed and then couldn’t reproduce, and a prompt <em>typo</em> that
          shipped because nothing tested the prompt’s behaviour.
        </p>
        <p>
          So I built an eval harness: a golden set where each case is a real
          past failure, run through the <em>actual shipping prompt</em> and
          graded by a stronger model against a rubric. The trick is you don’t
          trust a single score — output is non-deterministic — you trust the{" "}
          <strong>delta between runs</strong>. Change a prompt, run before and
          after, watch the failures move. It stays out of CI on purpose (it
          costs real calls and is noisy); I run it by hand before any model or
          prompt change.
        </p>
        <p>
          Then I automated the part I’d forget: an agent that reads real usage,
          judges it, and <em>proposes</em> new test cases for the failures — I
          approve them. Manual harness → an agent that grows it. That’s the line
          between “I called an API” and “I engineer an LLM system”: quality
          becomes a measured thing, not a hope.
        </p>
      </>
    ),
  },
  {
    slug: "deterministic-state-machines-pay-for-themselves",
    title: "deterministic state machines pay for themselves",
    oneLiner:
      "Make the core pure and the features you haven’t thought of get easier.",
    updated: "2026-06-11",
    related: ["keep-the-model-in-its-lane"],
    body: (
      <>
        <p>
          The riichi game engine is one <strong>GameState</strong> value and
          pure <strong>(state) → state</strong> functions — no mutation, no
          hidden globals. It felt like over-discipline at first. It paid for
          itself three times over.
        </p>
        <p>
          <strong>Testing:</strong> a pure function tests with no framework and
          no DOM — exactly what a rules engine with hundreds of edge cases
          needs. <strong>Concurrency:</strong> AI turns interleave
          asynchronously, and with no in-place mutation a value captured earlier
          can’t change under you. And the one I didn’t see coming —{" "}
          <strong>everything downstream came for free.</strong> Because the
          engine is deterministic, a game saves as a tiny seed-plus-inputs tape
          that re-derives byte-for-byte. From that same substrate I got replay,
          export to a standard log format, and tile-level post-game review —
          none of which I designed up front.
        </p>
        <p>
          Determinism isn’t a constraint you pay for; it’s a{" "}
          <strong>substrate you build on</strong>. Make the core a pure state
          machine, and the features you haven’t thought of yet get easier.
        </p>
      </>
    ),
  },
  {
    slug: "validate-your-environment-at-the-edge",
    title: "validate your environment at the edge",
    oneLiner:
      "Fail loud and early on bad config — but be precise about which edge.",
    updated: "2026-06-08",
    body: (
      <>
        <p>
          A missing or malformed environment variable should fail{" "}
          <strong>loudly, immediately, and in one place</strong> — not as a
          cryptic 500 three layers deep at 2am. I validate the whole env up
          front with a schema, so a bad config is a clear startup error naming
          exactly what’s wrong.
        </p>
        <p>
          One sharp lesson, though: do it at <em>runtime</em>, not at
          module-load / build time. I once had build-time validation crash CI
          because the build environment legitimately didn’t have the runtime
          secrets. The check was “correct” and still wrong — because it ran in
          the wrong place.
        </p>
        <p>
          The principle: push correctness checks to the edge of the system
          (config in, requests in) where the error is obvious and local — but be
          precise about <em>which</em> edge, because “as early as possible” can
          be too early.
        </p>
      </>
    ),
  },
  {
    slug: "casual-is-the-hardest-register",
    title: "casual is the hardest register",
    oneLiner:
      "The impressive case is the messy, unwritten one — so build for it.",
    updated: "2026-06-10",
    related: ["a-prompt-is-a-vote"],
    body: (
      <>
        <p>
          Everyone assumes formal language is the hard part — all that keigo.
          It’s backwards. Formal Japanese is rule-bound and learnable;{" "}
          <strong>casual</strong> is where you sound native or you don’t, and
          there’s no rulebook for じゃん vs よ vs 草.
        </p>
        <p>
          This is the whole reason tone-translator exists. A literal translator
          gives you stiff, textbook output that reads as non-native on sight. A
          chatbot can do better, but you re-explain “natural, casual, no romaji”
          every single time and the context drifts as the chat grows. The
          product is one tuned, hardened prompt for <em>naturalness</em> behind
          a one-tap interface — so casual comes out sounding like a person,
          every time.
        </p>
        <p>
          The lesson generalises past Japanese:{" "}
          <strong>
            the impressive thing usually isn’t the formal, structured case.
          </strong>{" "}
          It’s the messy, unwritten, “you just have to know” case — and that’s
          the one worth building for.
        </p>
      </>
    ),
  },
];

export function getNote(slug: string): Note | undefined {
  return notes.find((n) => n.slug === slug);
}

/** "2026-06-21" → "Jun 21, 2026" (deterministic, UTC). */
export function formatNoteDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}
