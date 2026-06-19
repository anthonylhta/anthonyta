Start a new feature branch for the anthonyta hub.

1. Create and check out a branch named `feat/$ARGUMENTS`.
2. Remind me of the standard implementation order for this project (connector pattern, ADR 0003):
   - `src/lib/connectors/<key>.ts` — the read first (server-side, read-only; returns a normalized shape)
   - `src/lib/...` — any new types / pure helpers (unit-tested)
   - `src/components/terminal/...` — the module / presentational piece
   - `src/app/.../page.tsx` — wire it into the page (swap the `src/lib/mock.ts` field for the connector)
3. Remind me to make a separate commit for each of those layers, not one big commit.
4. Remind me: if this embodies a design decision, write an ADR in `notes/decisions/` (next number in `notes/README.md`); public-vs-private behaviour follows ADR 0004.
