/**
 * Canonical site identity — the single source of truth for SEO surfaces
 * (metadata, sitemap, robots, JSON-LD, the OG image). Kept here so the URL,
 * description, and the PUBLIC route list are defined once.
 */
export const SITE_URL = "https://anthonyta.dev";
export const SITE_NAME = "Anthony Ta";
export const SITE_TAGLINE = "builder · languages · markets";
export const SITE_DESCRIPTION =
  "A personal hub & portfolio: a live reading shelf, a daily riichi hand, a morning markets briefing, and a tone-aware Japanese translator — built on a read-only connector pattern.";
export const GITHUB_LOGIN = "anthonylhta";
export const GITHUB_URL = `https://github.com/${GITHUB_LOGIN}`;

/**
 * Crawlable routes only — the public lobby surfaces. The owner-only pages
 * (`/vault`, `/portfolio`) are deliberately ABSENT: they 404 for guests, so a
 * crawler never indexes them, and naming them in the sitemap or robots.txt would
 * advertise that a private mode exists (ADR 0022). Silence is the gate.
 */
export const PUBLIC_ROUTES = [
  "",
  "/briefing",
  "/riichi",
  "/translator",
  "/projects",
  "/projects/riichi",
  "/projects/tone-translator",
  "/novels",
  "/notes",
  "/uses",
  "/contact",
] as const;
