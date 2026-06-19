/**
 * Placeholder data for the homepage modules. Each field here is replaced, one at
 * a time, by a real connector read (`src/lib/connectors/*`, ADR 0003). This file
 * is the explicit "what's still mocked" inventory.
 */

export const me = {
  name: "anthony ta",
  tagline: "builder · languages · markets",
} as const;

/** TODO(connector: translator) — JP immersion streak from tone-translator usage */
export const now = {
  jpStreakDays: 41,
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

/** TODO(connector: finance) — daily Claude-generated briefing, cached in hub DB */
export const briefing = {
  date: "2026-06-19",
  items: [
    "Nikkei 225 +1.2% — exporters lead on a softer yen",
    "USD/JPY 156.3 · 10Y UST 4.31%",
    "Watchlist: nothing triggered overnight",
  ],
};

export const nav = [
  { label: "projects", href: "/projects" },
  { label: "garden", href: "/garden" },
  { label: "uses", href: "/uses" },
  { label: "contact", href: "/contact" },
] as const;
