/**
 * layout — the pure spine of the owner's layout config (roadmap 59, v1:
 * visibility only). Each adaptive surface (the public lobby, the private
 * command center) consults a hidden-keys list before rendering a module, so
 * "remove the tft section" is a data edit from /system, not a code change.
 *
 * The config is deliberately PLAINTEXT (stored at `meta/layout.json`): the
 * server must read the lobby's layout to render the public page for guests,
 * and that layout is literally visible to anyone who loads the site — sealing
 * it would protect nothing. The write stays owner-gated.
 *
 * Semantics that keep future deploys safe: the config names HIDDEN keys only,
 * so a module added later is visible by default (a config written before it
 * existed cannot silently hide it), and unknown keys are dropped on
 * normalize (a module removed from the code doesn't linger in the config).
 */

export interface ModuleDef {
  key: string;
  label: string;
}

/** The lobby's toggleable sections (structural chrome — status bar, prompt,
 *  nav — is not on the menu). */
export const LOBBY_MODULES: ModuleDef[] = [
  { key: "languages", label: "languages (jp streak + tone mix)" },
  { key: "reading", label: "reading (current serial)" },
  { key: "riichi", label: "riichi (hand of the day teaser)" },
  { key: "github", label: "code (contributions heatmap)" },
  { key: "tft", label: "arena (tft ladder)" },
  { key: "briefing", label: "briefing (tape + driver)" },
];

/** The command center's toggleable sections. */
export const CENTER_MODULES: ModuleDef[] = [
  { key: "dropbox", label: "drop inbox (sealed messages)" },
  { key: "weather", label: "weather (sydney)" },
  { key: "transit-next", label: "next trip (transit)" },
  { key: "networth", label: "net worth glance" },
  { key: "vault-today", label: "today's daily note" },
  { key: "todo", label: "quick capture (todo list)" },
  { key: "briefing", label: "briefing glance" },
  { key: "hand", label: "today's hand" },
  { key: "week", label: "this week (activity digest)" },
  { key: "tft", label: "arena (tft ladder)" },
  { key: "totp", label: "2fa codes" },
];

export type Surface = "lobby" | "center";

/** Hidden module keys per surface — visibility only (v1). */
export interface LayoutConfig {
  v: 1;
  lobby: string[];
  center: string[];
}

export const EMPTY_LAYOUT: LayoutConfig = { v: 1, lobby: [], center: [] };

/** Body cap for the PUT — the config is a handful of short strings. */
export const LAYOUT_MAX_BYTES = 4096;

const KNOWN: Record<Surface, Set<string>> = {
  lobby: new Set(LOBBY_MODULES.map((m) => m.key)),
  center: new Set(CENTER_MODULES.map((m) => m.key)),
};

function normalizeKeys(x: unknown, surface: Surface): string[] | null {
  if (!Array.isArray(x) || x.length > 50) return null;
  const out: string[] = [];
  for (const k of x) {
    if (typeof k !== "string") return null;
    if (KNOWN[surface].has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Strict parse: null on anything unrecognizable (the route answers 400);
 *  unknown/duplicate keys are silently dropped, not errors — that's how a
 *  stale config survives module renames and removals. */
export function normalizeLayout(x: unknown): LayoutConfig | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return null;
  const lobby = normalizeKeys(o.lobby, "lobby");
  const center = normalizeKeys(o.center, "center");
  if (!lobby || !center) return null;
  return { v: 1, lobby, center };
}

/** The render-side view: which keys does `surface` hide right now. */
export function hiddenSet(cfg: LayoutConfig, surface: Surface): Set<string> {
  return new Set(surface === "lobby" ? cfg.lobby : cfg.center);
}

/** One toggle, pure: hide or show `key` on `surface`. Unknown keys no-op. */
export function setHidden(
  cfg: LayoutConfig,
  surface: Surface,
  key: string,
  hidden: boolean,
): LayoutConfig {
  if (!KNOWN[surface].has(key)) return cfg;
  const current = surface === "lobby" ? cfg.lobby : cfg.center;
  const next = hidden
    ? current.includes(key)
      ? current
      : [...current, key]
    : current.filter((k) => k !== key);
  return surface === "lobby"
    ? { ...cfg, lobby: next }
    : { ...cfg, center: next };
}
