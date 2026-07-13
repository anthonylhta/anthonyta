/**
 * Placeholder data for the homepage modules. Each field here is replaced, one at
 * a time, by a real connector read (`src/lib/connectors/*`, ADR 0003). This file
 * is the explicit "what's still mocked" inventory.
 */

export const me = {
  name: "anthony ta",
  tagline: "builder · languages · markets",
  // one quiet line under the prompt — who I am + a soft availability signal for
  // the lobby's recruiter audience (ADR 0004).
  intro: "sydney · building things in typescript · open to work",
} as const;

/** TODO(connector: webnovel) — current read + progress from webnovelist (Supabase) */
export const reading = {
  title: "Lord of the Mysteries",
  chapter: 221,
  total: 300,
};

/** TODO(connector: riichi) — today's hand id + your streak from riichi (Neon) */
export const riichi = {
  handNo: 412,
  solved: false,
};

// `ready: false` renders as an inert placeholder (present, but no navigation) until
// the page exists — flip to `true` when the route is built (roadmap #10).
export const nav = [
  { label: "projects", href: "/projects", ready: true },
  { label: "novels", href: "/novels", ready: true },
  { label: "notes", href: "/notes", ready: true },
  { label: "contact", href: "/contact", ready: true },
] as const;
