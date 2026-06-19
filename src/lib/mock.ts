/**
 * Placeholder data for the homepage modules. Each field here is replaced, one at
 * a time, by a real connector read (`src/lib/connectors/*`, ADR 0003). This file
 * is the explicit "what's still mocked" inventory.
 */

export const me = {
  name: "anthony ta",
  tagline: "builder · languages · markets",
} as const;

/** `build` is still placeholder; the JP streak is now live (connector: translator). */
export const now = {
  build: { value: 83, max: 100 }, // placeholder "site build" progress
};

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

export const nav = [
  { label: "projects", href: "/projects" },
  { label: "garden", href: "/garden" },
  { label: "uses", href: "/uses" },
  { label: "contact", href: "/contact" },
] as const;
