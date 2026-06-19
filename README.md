# anthonyta

Personal hub + portfolio for Anthony Ta — a **Warm Terminal** dashboard that
aggregates my other projects (riichi, webnovelist, tone-translator) as live data,
with a public lobby for visitors and a private command center for daily use.

Live at [anthonyta.dev](https://anthonyta.dev).

## Stack

Next.js 16 (App Router, React 19) · TypeScript · Tailwind v4 · Neon · Vercel.

## Develop

```bash
npm run dev      # http://localhost:3000
npm run check    # typecheck (tsc --noEmit)
npm run lint     # eslint
npm run test     # vitest
npm run build    # production build
```

## Architecture

Each project is a read-only **connector** (`src/lib/connectors/`) that returns a
normalized shape the hub renders; the hub never writes to a project's DB. The
homepage renders `src/lib/mock.ts` until each connector is wired. See
`notes/decisions/` for the design record (local, not committed).
