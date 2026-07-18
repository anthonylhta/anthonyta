# anthonyta.dev

My personal hub — a **Warm Terminal** dashboard that pulls my other projects in as
live, read-only data. Two faces of one system: a public **lobby** for visitors and a
private **command center** for daily use.

**Live at [anthonyta.dev](https://anthonyta.dev)**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white)
![WebAuthn](https://img.shields.io/badge/WebAuthn-passkeys-5865F2?logo=webauthn&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000?logo=vercel&logoColor=white)

## The idea

The homepage adapts to who's looking. Signed out, you get the **lobby** — a curated,
read-only slice for visitors. Signed in (just me, via passkey), it becomes the
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

| surface      | source                        | what it shows                                                            |
| ------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `webnovel`   | Supabase                      | current reading shelf, plus live % on the curated `/novels` list         |
| `riichi`     | riichi's public API + Neon    | the daily mahjong hand, re-rendered natively, plus my solve streak       |
| `github`     | GitHub GraphQL                | public contributions heatmap, streak, latest push                        |
| `translator` | Supabase                      | ishin's Japanese ⇄ English translation stats + register breakdown        |
| `briefing`   | scheduled ingestion           | a daily markets briefing (the hub never calls a model — zero token cost) |
| `portfolio`  | end-to-end encrypted envelope | holdings, P&L, and a net-worth trend — decrypted only in my browser      |

Aggregate stats are public; anything personal never exists server-side in readable
form at all — which brings us to:

## Private by construction — end-to-end encryption

Everything personal on the hub — a private file inbox, the financials, my Obsidian
journal — is **encrypted in the browser before it leaves the device** and stored as
ciphertext in a Cloudflare R2 bucket. The server (and the storage) hold bytes they
cannot read: keys derive from a passphrase via WebCrypto (PBKDF2 → a wrapped master
key), decryption happens client-side after an explicit unlock, and no plaintext or
key material ever transits a server function.

Some shapes that fell out of holding that line:

- **The portfolio imports itself.** I drop a broker CSV into the unlocked page; the
  browser parses it and seals holdings plus a dated invested entry into the envelope.
  The net-worth trend reconstructs client-side from those dated entries — the server
  never touches a figure, even transiently.
- **Sharing without weakening.** Sharing an encrypted file re-encrypts it under a
  fresh one-time key that rides the URL `#fragment` — the one part of a URL a browser
  never sends — so the server serves ciphertext it can't open, and links expire by
  construction (the expiry is baked into the blob's name).
- **A read-only journal mirror.** A local script walks my Obsidian vault, seals each
  changed note and image, and uploads ciphertext under opaque content-derived ids —
  the store never sees a title or a path. The reader decrypts in-page.
- **Absence is a proof, not a guess.** Store reads are three-state (ok / absent /
  error) because "nothing there yet" arms first-run setup paths that mint fresh keys —
  a transient failure misread as absence would orphan everything. First-run writes are
  conditional (`If-None-Match: *`), so a mistaken client physically cannot overwrite
  live key material.

## Sign-in without a third party

Authentication is **passkeys only** — a hand-rolled WebAuthn ceremony (challenge in a
signed single-use cookie, no database, the credential record stored as one small
document) feeding Auth.js session issuance. No OAuth provider, no password, nothing to
phish, and no outside service observes a login. Break-glass paths (a one-time recovery
code; a secret-token-gated re-enrollment) are designed to be safe by construction
rather than by configuration discipline.

## Hardening

- **Strict Content-Security-Policy, enforcing** — per-request nonces with
  `'strict-dynamic'`, minted in middleware; shipped report-only first, flipped after a
  clean soak.
- **Guests get a 404 wall** — every private route and API collapses to the same 404,
  with no existence oracles; a request-only Playwright suite locks those invariants in
  CI (owner routes 404, no private data in public HTML, headers byte-exact).
- Baseline headers (HSTS, nosniff, frame-ancestors, referrer/permissions policy),
  self-hosted fonts, zero analytics, zero tracking.

## Aesthetic — Warm Terminal

Warm charcoal base (never pure black), a hairline grid, a single amber accent, with
green/red reserved for live finance. Monospace carries the identity; a live Sydney
clock, a blinking prompt cursor, and a ⌘K command palette are the signature touches.

## Installable — PWA

The hub installs to a phone's home screen and launches standalone, so it opens like an
app instead of a browser tab. A web manifest (`app/manifest.ts`) carries the shell
colors and a long-press jump-list to the daily surfaces; the app icon is rendered
through the same `next/og` pipeline as the share card (`lib/pwa`), so it stays on
brand — the amber prompt on warm charcoal — across Android (`any` + `maskable`) and
iOS. A small service worker (`public/sw.js`) adds offline resilience: network-first for
pages so an online launch is never stale, with a hand-drawn `/offline` shell as the
fallback. `/api/` and cross-origin requests are never cached. An in-app prompt
(`InstallPrompt`) offers the native install on Chromium and the Share → Add to Home
Screen recipe on iOS, and self-hides once installed.

## Stack

Next.js 16 (App Router, React 19) · TypeScript · Tailwind v4 · Auth.js v5 +
hand-rolled WebAuthn · WebCrypto (client-side E2EE) · Cloudflare R2 (ciphertext only)
· Supabase + Neon reads · Vercel.

## Develop

```bash
npm run dev       # http://localhost:3000
npm run check     # typecheck (tsc --noEmit)
npm run lint      # eslint
npm run test      # vitest
npm run build     # production build
npm run test:e2e  # request-only Playwright gating suite (build first)
```
