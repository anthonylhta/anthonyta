/**
 * resume — the /resume page's content, versioned in code (the /novels
 * curated-list pattern; roadmap 82a). Updating the resume = editing this file,
 * PR'd like everything else; the page's print stylesheet makes window.print()
 * the PDF story, so this stays the single source of truth.
 *
 * Deliberate deltas from the application PDF (owner-ruled 2026-08-23): the
 * phone number stays OFF the open web (the PDF he hands out keeps it);
 * Tone Translator is named by its rebrand, Ishin; test/PR counts read the
 * current figures rather than the PDF's snapshot.
 */

export interface ResumeLink {
  label: string;
  href: string;
}

export interface ResumeBullet {
  /** Optional bolded lead-in ("Prompt engineering — …"). */
  lead?: string;
  text: string;
}

export interface ResumeEntry {
  title: string;
  when?: string;
  /** Left half of the subline — org, degree. */
  sub?: string;
  /** Right half of the subline — location, "remote". */
  where?: string;
  stack?: string;
  links?: ResumeLink[];
  bullets?: ResumeBullet[];
}

export interface ResumeSection {
  label: string;
  entries: ResumeEntry[];
}

export const IDENTITY = {
  name: "Anthony Ta",
  location: "Sydney, NSW",
  email: "anthony.ta@live.com",
  links: [
    { label: "anthonyta.dev", href: "https://anthonyta.dev" },
    { label: "github.com/anthonylhta", href: "https://github.com/anthonylhta" },
    {
      label: "linkedin.com/in/anthonylhta",
      href: "https://linkedin.com/in/anthonylhta",
    },
  ] satisfies ResumeLink[],
};

export const SECTIONS: ResumeSection[] = [
  {
    label: "education",
    entries: [
      {
        title: "University of Sydney",
        when: "2021 – 2025",
        sub: "B. Advanced Computing — Computer Science",
        where: "Camperdown, Australia",
      },
    ],
  },
  {
    label: "experience",
    entries: [
      {
        title: "AI Trainer & Evaluator",
        when: "jan 2025 – now",
        sub: "Outlier AI",
        where: "remote",
        bullets: [
          {
            lead: "Prompt engineering",
            text: "50+ multi-step prompts in Python and Java stress-testing LLM reasoning across edge cases.",
          },
          {
            lead: "Model evaluation",
            text: "reviewed and ranked AI-generated code on correctness, efficiency and style; structured feedback fed production training pipelines.",
          },
        ],
      },
    ],
  },
  {
    label: "projects",
    entries: [
      {
        title: "anthonyta.dev — personal hub & E2EE command center",
        when: "2026",
        stack: "Next.js · React · TypeScript · Cloudflare R2",
        links: [{ label: "you are here", href: "/" }],
        bullets: [
          {
            text: "Dual-face platform on one codebase: a public portfolio aggregating six live sources (GitHub GraphQL, Riot API, app databases, transit and weather feeds) through a guarded connector layer that degrades to sample data on any upstream failure — and a private, passkey-gated command center used daily for finances, training, meals and scheduling.",
          },
          {
            text: "Client-side end-to-end encryption for all personal data: AES-GCM envelopes with path-bound AAD, WebAuthn passkeys with PRF-derived vault unlock, Shamir secret-sharing paper recovery, and a crash-tested master-key rotation state machine — the server only ever stores ciphertext.",
          },
          {
            text: "Public/private boundary enforced with a strict-nonce CSP, HSTS preload, and an adversarial Playwright suite that derives every route from the filesystem and proves guests receive byte-identical 404s on every owner route; 1,790+ unit tests on branch-protected CI across 200 merged PRs.",
          },
        ],
      },
      {
        title: "Ishin — JP⇄EN translation that lands as meant",
        when: "2026",
        stack: "Next.js · TypeScript · Claude API",
        links: [{ label: "ishin.io ↗", href: "https://ishin.io" }],
        bullets: [
          {
            text: "Streaming JP⇄EN translator where naturalness beats literal; per-direction models and generating only the selected register cut per-translation output tokens ~50%.",
          },
          {
            text: "Naturalness-check mode verdicts your own JP or EN in real time — register-aware feedback with the verdict line styled as it streams.",
          },
        ],
      },
      {
        title: "Riichi — solo mahjong learning platform",
        when: "2026",
        stack: "SvelteKit · TypeScript · Postgres · Rust/WASM",
        links: [{ label: "live ↗", href: "https://riichi.anthonyta.dev" }],
        bullets: [
          {
            text: "Pure-functional riichi engine for solo play against three rule-based opponents, enforcing the complete ruleset (riichi, furiten, kan, abortive draws, double ron) with yaku detection and scoring delegated to a Rust/WASM library validated on millions of Tenhou hands.",
          },
          {
            text: "Deterministic replay logging reconstructs any game from its wall and inputs — Postgres-backed history, in-browser playback, and export to the MJAI and tenhou.net/6 formats consumed by the Mortal AI reviewer.",
          },
        ],
      },
    ],
  },
];

export const SKILLS: { group: string; items: string }[] = [
  {
    group: "languages",
    items: "Python · Java · JavaScript · TypeScript · C · C++ · SQL",
  },
  {
    group: "frameworks",
    items: "Next.js · React · Node.js · SvelteKit · TensorFlow",
  },
  {
    group: "tools",
    items:
      "Git/GitHub · Docker · PostgreSQL · REST APIs · Linux · Vercel · Cloudflare R2 · Playwright · Vitest · WebAuthn · Clerk",
  },
  {
    group: "ai / ml",
    items: "Claude API · OpenAI API · ResNet · ArcFace · prompt engineering",
  },
];
