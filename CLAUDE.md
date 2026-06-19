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
- Hub DB: **Neon** (serverless Postgres) — site-only data: finance briefings, the weekly
  digest, garden metadata, single-user auth. (Not yet wired — ADR 0001.)
- AI: Claude via the **Vercel AI Gateway** (briefings, digest, coaching). (Not yet wired.)
- Hosting: Vercel.

## Architecture

- **Connector pattern (ADR 0003):** each of Anthony's projects is a read-only data source.
  `src/lib/connectors/<key>.ts` reads ONE source and returns a normalized shape; the hub
  never writes to a project DB. Adding a project = adding a connector. Sources:
  | key | source | gives |
  |---|---|---|
  | `webnovel` | Supabase (`webnovelist`) | reading shelf, stats |
  | `translator` | Supabase (`tone-translator`) | vocab, JP language stats |
  | `riichi` | Neon (`riichi`) | hand of the day, streaks |
  | `finance` | hub DB / `risk_first_paper_bot` | daily briefing, portfolio |
- Until a source is wired, the homepage renders `src/lib/mock.ts`. Swapping a mock field
  for `await connector.fetch()` is the whole migration, per feature.
- **Public lobby vs private command center (ADR 0004):** same terminal shell, two modes.
  `StatusBar user="guest"` is public; signed-in passes the handle. Private auth is
  single-user (it's just Anthony) — do not overbuild it.

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
- TODO (not yet set up): GitHub repo + branch protection, Husky pre-commit, Dependabot,
  Neon hub DB + env validation, auth. See ADR 0001 "Consequences".

## Aesthetics — Warm Terminal (ADR 0002)

- Warm charcoal base `#0e0d0b` (never pure black), warm off-white text, hairline grid,
  **amber `#f5a524`** accent (sparingly), green `#7fd17f` / red `#e5604d` only for live /
  finance. Mono (Geist Mono) carries the identity; sans (Geist Sans) for prose; JP via a
  system stack (`--font-jp`) for now.
- Tokens in `src/app/globals.css`. Repeating unit is the bordered `Module` card; signature
  touches are the JST live clock + blinking prompt cursor + ⌘K command palette.

## Roadmap (vertical slice first, then connectors)

1. [x] Warm Terminal shell — status bar, ⌘K, module grid (mock data).
2. [ ] First live connector — `webnovel` (Supabase) → Reading module. Proves the pattern.
3. [ ] `riichi` (Neon) → hand of the day, read-only → playable.
4. [ ] Hub DB + finance briefing cron (Claude) → Briefing module.
5. [ ] Auth gate → private command center.
6. [ ] Garden (MDX) + project pages (`/projects`, `/garden`, `/uses`, `/contact` are stubs).
