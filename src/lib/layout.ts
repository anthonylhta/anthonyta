/**
 * layout — the pure spine of the owner's layout config (roadmap 59). Each
 * adaptive surface (the public lobby, the private command center) renders its
 * modules from this config: which are HIDDEN, and in what ORDER. So "remove the
 * tft section" and "put weather above net worth" are data edits from /system,
 * not code changes.
 *
 * The config is deliberately PLAINTEXT (stored at `meta/layout.json`): the
 * server must read the lobby's layout to render the public page for guests, and
 * that layout is literally visible to anyone who loads the site — sealing it
 * would protect nothing. The write stays owner-gated.
 *
 * Two vocabularies:
 *   - MODULES are the hideable blocks (each `[x]` toggle in the panel).
 *   - UNITS are the orderable blocks. A unit is usually one module, but a few
 *     are visually GROUPED and move together (the lobby's languages+reading+
 *     riichi card, the command center's briefing+hand row). The command center's
 *     `dropbox` is a FIXED unit — hideable, but pinned above both zones.
 *
 * Forward-compat that keeps deploys safe: the config names HIDDEN keys only (a
 * module added later is visible by default — a config predating it can't hide
 * it) and lists ORDER explicitly (a unit not in the order falls to its default
 * position, never lost). Unknown keys are dropped on normalize. A stored v1
 * config (hidden-only) reads as a v2 with empty order — identical rendering.
 */

export interface ModuleDef {
  key: string;
  label: string;
}

/** The reorderable zone a unit belongs to (command center only). `fixed` units
 *  are pinned above the zones and never reorder; lobby units have no zone. */
export type Zone = "fixed" | "today" | "week";

export interface UnitDef {
  /** Stable orderable-unit id (== the module key for single-module units). */
  key: string;
  /** Panel label for the unit (group units name their members). */
  label: string;
  /** Command-center zone; omitted for lobby units (one flow, no zones). */
  zone?: Zone;
  /** The hideable modules inside, in display order (usually one). */
  modules: ModuleDef[];
}

// --- the two surfaces' units (the source of truth for both order and hiding) --

export const LOBBY_UNITS: UnitDef[] = [
  {
    key: "top",
    label: "languages + reading + riichi",
    modules: [
      { key: "languages", label: "languages (jp streak + tone mix)" },
      { key: "reading", label: "reading (current serial)" },
      { key: "riichi", label: "riichi (hand of the day teaser)" },
    ],
  },
  {
    key: "github",
    label: "code (contributions heatmap)",
    modules: [{ key: "github", label: "code (contributions heatmap)" }],
  },
  {
    key: "tft",
    label: "arena (tft ladder)",
    modules: [{ key: "tft", label: "arena (tft ladder)" }],
  },
  {
    key: "briefing",
    label: "briefing (tape + driver)",
    modules: [{ key: "briefing", label: "briefing (tape + driver)" }],
  },
];

export const CENTER_UNITS: UnitDef[] = [
  {
    key: "dropbox",
    zone: "fixed",
    label: "drop inbox (sealed messages)",
    modules: [{ key: "dropbox", label: "drop inbox (sealed messages)" }],
  },
  {
    key: "weather",
    zone: "today",
    label: "weather (sydney)",
    modules: [{ key: "weather", label: "weather (sydney)" }],
  },
  {
    key: "transit-next",
    zone: "today",
    label: "next trip (transit)",
    modules: [{ key: "transit-next", label: "next trip (transit)" }],
  },
  {
    key: "networth",
    zone: "today",
    label: "net worth glance",
    modules: [{ key: "networth", label: "net worth glance" }],
  },
  {
    key: "vault-today",
    zone: "today",
    label: "today's daily note",
    modules: [{ key: "vault-today", label: "today's daily note" }],
  },
  {
    key: "todo",
    zone: "today",
    label: "quick capture (todo list)",
    modules: [{ key: "todo", label: "quick capture (todo list)" }],
  },
  {
    key: "briefing-hand",
    zone: "today",
    label: "briefing + hand",
    modules: [
      { key: "briefing", label: "briefing glance" },
      { key: "hand", label: "today's hand" },
    ],
  },
  {
    key: "week",
    zone: "week",
    label: "this week (activity digest)",
    modules: [{ key: "week", label: "this week (activity digest)" }],
  },
  {
    key: "chores",
    zone: "week",
    label: "chores (csv / vault-sync / backup)",
    modules: [{ key: "chores", label: "chores (csv / vault-sync / backup)" }],
  },
  {
    key: "health",
    zone: "week",
    label: "project health (riichi / webnovel / ishin)",
    modules: [
      { key: "health", label: "project health (riichi / webnovel / ishin)" },
    ],
  },
  {
    key: "tft",
    zone: "week",
    label: "arena (tft ladder)",
    modules: [{ key: "tft", label: "arena (tft ladder)" }],
  },
  {
    key: "totp",
    zone: "week",
    label: "2fa codes",
    modules: [{ key: "totp", label: "2fa codes" }],
  },
];

export type Surface = "lobby" | "center";

const UNITS: Record<Surface, UnitDef[]> = {
  lobby: LOBBY_UNITS,
  center: CENTER_UNITS,
};

/** The hideable modules of a surface, flattened in default order. */
export function modulesOf(surface: Surface): ModuleDef[] {
  return UNITS[surface].flatMap((u) => u.modules);
}

/** Legacy flat module lists (kept for any older consumer). */
export const LOBBY_MODULES = modulesOf("lobby");
export const CENTER_MODULES = modulesOf("center");

// --- config shape -------------------------------------------------------------

/** Hidden module keys + ordered unit keys, per surface. */
export interface LayoutConfig {
  v: 2;
  lobby: string[];
  center: string[];
  /** Ordered lobby UNIT keys; unlisted units fall to default position. */
  lobbyOrder: string[];
  /** Ordered command-center UNIT keys (reorderable zones only). */
  centerOrder: string[];
}

export const EMPTY_LAYOUT: LayoutConfig = {
  v: 2,
  lobby: [],
  center: [],
  lobbyOrder: [],
  centerOrder: [],
};

/** Body cap for the PUT — a handful of short strings. */
export const LAYOUT_MAX_BYTES = 4096;

const KNOWN_MODULES: Record<Surface, Set<string>> = {
  lobby: new Set(modulesOf("lobby").map((m) => m.key)),
  center: new Set(modulesOf("center").map((m) => m.key)),
};

/** Reorderable unit keys per surface — fixed units (dropbox) are excluded, so a
 *  stale order can never claim to reposition a pinned block. */
const REORDERABLE: Record<Surface, Set<string>> = {
  lobby: new Set(
    UNITS.lobby.filter((u) => u.zone !== "fixed").map((u) => u.key),
  ),
  center: new Set(
    UNITS.center.filter((u) => u.zone !== "fixed").map((u) => u.key),
  ),
};

function normalizeKeys(x: unknown, known: Set<string>): string[] | null {
  if (!Array.isArray(x) || x.length > 50) return null;
  const out: string[] = [];
  for (const k of x) {
    if (typeof k !== "string") return null;
    if (known.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Strict parse: null on anything unrecognizable (the route answers 400). A v1
 * config (`{v:1, lobby, center}`, hidden-only) reads as a v2 with empty order.
 * Unknown/duplicate keys are silently dropped, not errors — that's how a stale
 * config survives module renames, removals, and re-groupings.
 */
export function normalizeLayout(x: unknown): LayoutConfig | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 && o.v !== 2) return null;

  const lobby = normalizeKeys(o.lobby, KNOWN_MODULES.lobby);
  const center = normalizeKeys(o.center, KNOWN_MODULES.center);
  if (!lobby || !center) return null;

  // v1 has no order fields; a v2 may omit them (order is a refinement over
  // hiding) — both default to empty, which renders in the default order. A
  // PRESENT-but-malformed order (a non-array) is still a hard reject.
  const lobbyOrder =
    o.v === 1 ? [] : normalizeKeys(o.lobbyOrder ?? [], REORDERABLE.lobby);
  const centerOrder =
    o.v === 1 ? [] : normalizeKeys(o.centerOrder ?? [], REORDERABLE.center);
  if (!lobbyOrder || !centerOrder) return null;

  return { v: 2, lobby, center, lobbyOrder, centerOrder };
}

// --- visibility ---------------------------------------------------------------

/** The render-side view: which module keys does `surface` hide right now. */
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
  if (!KNOWN_MODULES[surface].has(key)) return cfg;
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

// --- ordering -----------------------------------------------------------------

function orderArr(cfg: LayoutConfig, surface: Surface): string[] {
  return surface === "lobby" ? cfg.lobbyOrder : cfg.centerOrder;
}

/**
 * The surface's units in effective order: those listed in the config's order
 * first (in that order), then any unit the order omits, in default order. Fixed
 * units (dropbox) keep their default position at the front regardless — they're
 * never reorderable. Every known unit appears exactly once.
 */
export function orderedUnits(cfg: LayoutConfig, surface: Surface): UnitDef[] {
  const defs = UNITS[surface];
  const byKey = new Map(defs.map((u) => [u.key, u]));
  const order = orderArr(cfg, surface);

  const fixed = defs.filter((u) => u.zone === "fixed");
  const seen = new Set<string>(fixed.map((u) => u.key));
  const rest: UnitDef[] = [];
  for (const k of order) {
    const u = byKey.get(k);
    if (u && u.zone !== "fixed" && !seen.has(k)) {
      rest.push(u);
      seen.add(k);
    }
  }
  for (const u of defs) if (!seen.has(u.key)) rest.push(u);
  return [...fixed, ...rest];
}

/** The units of one zone, in effective order (their relative order preserved). */
export function orderedUnitsInZone(
  cfg: LayoutConfig,
  surface: Surface,
  zone: Zone,
): UnitDef[] {
  return orderedUnits(cfg, surface).filter((u) => u.zone === zone);
}

/** The zone a unit belongs to (undefined for lobby units). */
function unitZone(surface: Surface, key: string): Zone | undefined {
  return UNITS[surface].find((u) => u.key === key)?.zone;
}

/**
 * Move a unit one step within its zone (dir −1 = up, +1 = down). A no-op at a
 * zone edge, on a fixed/unknown unit, or when the neighbor would leave the zone.
 * Rewrites the FULL surface order so the change round-trips through the config.
 */
export function moveUnit(
  cfg: LayoutConfig,
  surface: Surface,
  key: string,
  dir: -1 | 1,
): LayoutConfig {
  if (!REORDERABLE[surface].has(key)) return cfg;
  const zone = unitZone(surface, key);
  // Reorder within the unit's own zone (lobby units share the undefined zone).
  const zoneKeys = orderedUnits(cfg, surface)
    .filter((u) => u.zone === zone)
    .map((u) => u.key);
  const i = zoneKeys.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= zoneKeys.length) return cfg;
  [zoneKeys[i], zoneKeys[j]] = [zoneKeys[j], zoneKeys[i]];

  // Splice the reordered zone back into the full reorderable order, keeping the
  // other zone's units where they were.
  const full = orderedUnits(cfg, surface).filter((u) => u.zone !== "fixed");
  let z = 0;
  const nextOrder = full.map((u) => (u.zone === zone ? zoneKeys[z++] : u.key));

  return surface === "lobby"
    ? { ...cfg, lobbyOrder: nextOrder }
    : { ...cfg, centerOrder: nextOrder };
}

/** Whether `key` can move in `dir` (for greying the panel's arrows). */
export function canMove(
  cfg: LayoutConfig,
  surface: Surface,
  key: string,
  dir: -1 | 1,
): boolean {
  return (
    JSON.stringify(moveUnit(cfg, surface, key, dir)) !== JSON.stringify(cfg)
  );
}
