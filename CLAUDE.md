@AGENTS.md

# anthonyta — project guide

A personal hub + portfolio for Anthony Ta. Two faces of one system: a public
**lobby** (recruiters — a curated, read-only slice of the dashboard) and a private
**command center** (Anthony, signed in — the full daily driver). Aesthetic is
**Warm Terminal** (ADR 0002). Lives at `anthonyta.dev`.

This is not a project graveyard — it aggregates Anthony's other projects as live
data and is built to be iterated on forever (ADR 0003).

## Notes / documentation workflow (do this automatically, without being asked)

Maintain a local (git-ignored) log in `notes/`. **Everything except `notes/README.md`
is append-only and immutable — never edit a past entry.** To change a past decision,
write a NEW entry that supersedes the old one; only add a one-line
`Status: superseded by NNNN` header to the old file.

- **`notes/decisions/`** — when a notable design decision is made or discovered, write a
  numbered ADR (`NNNN-slug.md`, format Context → Decision → Consequences, with `Status`
  and `Date` headers). Cross-link related ADRs.
- **`notes/bugs/`** — when a bug is found and understood, write a dated `YYYY-MM-DD-slug.md`:
  symptoms, root cause, how it was found, the fix, the lesson. Also document suspected
  bugs that turn out NOT to be bugs (fragile-but-correct invariants), framed honestly.
- **`notes/README.md`** — the only editable file: keep the ADR/bug index tables and the
  "next number" pointer current.

Do this proactively as part of the work, not as a separate step to be prompted for.
Ground ADRs in the actual code.

## Repository rules

- **Commit voice — write as Anthony, first person, in the author's own voice (ADR 0005).**
  Plain capitalized sentences ("Add reading connector", "Fix ron check passing 14 tiles"),
  one logical change each. Never narrate the process or who found what — phrase a test-found
  bug as the author would ("Fix tile overflow found during testing"), never "User/Claude
  found…" or "the user noticed…". **No AI/Claude attribution** (no `Co-Authored-By: Claude`,
  no "Generated with Claude Code") in commits or PR bodies.
- **Don't tag commits with ADR numbers (ADR 0005).** `notes/` is gitignored, so "ADR 0042"
  resolves to nothing in the public history (which recruiters may read). Each commit stands
  alone; ADR cross-links live in `notes/` and CLAUDE.md, where they resolve.
- TypeScript · npm · prettier + eslint.
- **`main` is branch-protected.** Every change is a `<type>/<slug>` branch → PR → green CI
  → merge. Never push to `main`. (`fix/`, `feat/`, `refactor/`, `chore/`.)

## Stack

- Next.js 16 (App Router, React 19), TypeScript · Tailwind v4
- Auth: **Auth.js v5 (next-auth) + GitHub**, allow-listed to one account (ADR 0011).
- **Google Drive ingestion** via a read-only service account (`lib/google.ts`) for the daily
  briefing + the portfolio CSV — the hub never calls a model, zero token cost (ADR 0009, 0012).
- Hosting: **Vercel** (`anthonyta.dev`, auto-deploy on merge); DNS on Cloudflare (ADR 0008).
- No hub DB yet — a Neon hub DB stays an option if a write-feature ever needs one (ADR 0001).

## Architecture

- **Connector pattern (ADR 0003):** each of Anthony's projects is a read-only data source.
  `src/lib/connectors/<key>.ts` reads ONE source and returns a normalized shape; the hub
  never writes to a project DB. Adding a project = adding a connector. Sources:
  | key | source | gives | status |
  |---|---|---|---|
  | `webnovel` | Supabase (`webnovelist`) | reading shelf | ✅ |
  | `riichi` | Neon (`riichi`) | hand of the day (native re-render + inline grade) | ✅ |
  | `briefing` | Google Drive (Claude app → daily doc) | markets briefing | ✅ |
  | `portfolio` | Google Drive (CMC ProfitLoss CSV) | holdings, P&L (private) | ✅ |
  | `translator` | Supabase (`tone-translator`) | vocab, JP language stats | ⬚ next |
- Each connector is guarded → falls back to placeholder data (`mock.ts`, `sampleBriefing.ts`,
  `sampleDashboard.ts`) on missing env / error, so CI builds stay green.
- **Adaptive `/` — public lobby vs private command center (ADR 0004, 0011):** `app/page.tsx`
  reads the session — signed in → `<CommandCenter>` (portfolio, briefing take, streaks), else
  → `<Lobby>` (the public face). Single-user GitHub auth, no sign-up. The command center's
  private data (the portfolio) is never rendered publicly or committed.

## Local dev (WSL)

- node/npm are in **WSL/Ubuntu**, not on the Windows PATH. Run commands in WSL.
- **Node 20 + Neon = the `fetch failed` trap.** The Neon serverless driver talks HTTPS over
  global `fetch`; on WSL2 the dual-stack host's dead IPv6 + Node 20 Happy Eyeballs stalls
  every read with `TypeError: fetch failed` (NOT a DB outage). When the hub touches Neon,
  prefix the local Neon-touching npm scripts with
  `NODE_OPTIONS='--dns-result-order=ipv4first --no-network-family-autoselection'`
  (riichi's `notes/bugs/2026-06-13-neon-fetch-failed-wsl-ipv6.md`). Prod/Vercel unaffected.

## Commands

- `npm run dev` · `npm run build`
- `npm run check` (tsc --noEmit) · `npm run lint` (eslint) · `npm run test` (vitest)
- `npm run format` / `format:check` (prettier)
- `/check`, `/feature <slug>`, `/make-pr` (in `.claude/commands/`).

## Quality / CI baseline

- `.github/workflows/ci.yml` — npm ci → check → lint → test → build, on push/PR to `main`.
- `.claude/` hooks: `format-edited-file.cjs` (prettier on every edit), `pre-pr-check.cjs`
  (runs the full CI locally and blocks a red `gh pr create`), `notes-reminder.py` (nudges a
  notes entry after a `git commit`).
- Done: public GitHub repo + branch protection (PRs + CI required), Vercel auto-deploy on
  merge, GitHub auth. Still optional: Husky pre-commit, Dependabot, a Neon hub DB (only if a
  write-feature needs one).

## Aesthetics — Warm Terminal (ADR 0002)

- Warm charcoal base `#0e0d0b` (never pure black), warm off-white text, hairline grid,
  **amber `#f5a524`** accent (sparingly), green `#7fd17f` / red `#e5604d` only for live /
  finance. Mono (Geist Mono) carries the identity; sans (Geist Sans) for prose; JP via a
  system stack (`--font-jp`) for now.
- Tokens in `src/app/globals.css`. Repeating unit is the bordered `Module` card; signature
  touches are the Sydney live clock + blinking prompt cursor + ⌘K command palette.

## Roadmap

1. [x] Warm Terminal shell — status bar, ⌘K, module grid.
2. [x] `webnovel` connector (Supabase) → live Reading module.
3. [x] `riichi` connector (Neon) → Hand of the Day, native re-render + inline grading.
4. [x] Markets briefing — Google Drive ingestion + pre-warm cron.
5. [x] Deploy — `anthonyta.dev` (Vercel, Cloudflare DNS, auto-deploy).
6. [x] GitHub auth + adaptive homepage (lobby ↔ command center).
7. [x] Portfolio — CMC CSV via Drive, behind auth.
8. [ ] Unlock the briefing's "portfolio relevance" for the authed owner (data's already in the doc).
9. [ ] `translator` connector — JP vocab / language stats.
10. [ ] Garden (MDX) + project pages (`/projects`, `/garden`, `/uses`, `/contact` still stub).
11. [ ] Journal / "now" from the Obsidian vault; a cash/HISA line; the weekly digest.
