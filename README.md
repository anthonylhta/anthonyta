# anthonyta.dev

My personal hub — a **Warm Terminal** dashboard that pulls my other projects in as
live, read-only data. Two faces of one system: a public **lobby** for visitors and a
private **command center** for daily use.

**Live at [anthonyta.dev](https://anthonyta.dev)**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)
![Auth.js](https://img.shields.io/badge/Auth.js-v5-000?logo=auth0&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000?logo=vercel&logoColor=white)

## The idea

The homepage adapts to who's looking. Signed out, you get the **lobby** — a curated,
read-only slice for visitors. Signed in (just me, via GitHub), it becomes the
**command center**: the full daily driver, including private data that never reaches
the public page.

It's not a project graveyard. Each of my projects is wired in as a **live data
source**, so the hub reflects what I'm actually doing — today's reading, today's
mahjong hand, the markets, my Japanese practice — and it's built to be iterated on
forever.

## Architecture — the connector pattern

Each project is a read-only **connector** (`src/lib/connectors/`) that reads one
source and returns a normalized shape the hub renders. The hub never writes to a
project's database, so adding a project is just adding a connector. Every connector is
**guarded**: on a missing credential or any error it falls back to placeholder data,
so the build is always green and one source going down never takes the page down.

| connector    | source                   | surfaces                                                                 |
| ------------ | ------------------------ | ------------------------------------------------------------------------ |
| `webnovel`   | Supabase                 | current reading shelf                                                    |
| `riichi`     | Neon                     | the daily mahjong hand — re-rendered natively + graded inline            |
| `briefing`   | scheduled ingestion      | a daily markets briefing (the hub never calls a model — zero token cost) |
| `portfolio`  | private CSV, behind auth | holdings & P&L, never rendered publicly                                  |
| `translator` | Supabase                 | Japanese translation stats + tone breakdown                              |

Aggregate stats are public; anything private (the portfolio, raw translation text) is
read server-side and rendered only when I'm signed in — it never ships to a guest.

## Aesthetic — Warm Terminal

Warm charcoal base (never pure black), a hairline grid, a single amber accent, with
green/red reserved for live finance. Monospace carries the identity; a live Sydney
clock, a blinking prompt cursor, and a ⌘K command palette are the signature touches.

## Stack

Next.js 16 (App Router, React 19) · TypeScript · Tailwind v4 · Auth.js v5 (GitHub) ·
Supabase + Neon · Vercel.

## Develop

```bash
npm run dev      # http://localhost:3000
npm run check    # typecheck (tsc --noEmit)
npm run lint     # eslint
npm run test     # vitest
npm run build    # production build
```
