import { describe, expect, it } from "vitest";
import {
  CENTER_MODULES,
  CENTER_UNITS,
  EMPTY_LAYOUT,
  LOBBY_MODULES,
  LOBBY_UNITS,
  canMove,
  hiddenSet,
  moveUnit,
  normalizeLayout,
  orderedUnits,
  orderedUnitsInZone,
  setHidden,
  type LayoutConfig,
  type Zone,
} from "./layout";

const cfg = (o: Partial<LayoutConfig> = {}): LayoutConfig => ({
  ...EMPTY_LAYOUT,
  ...o,
});

/** The TODAY zone's default order — the day's rows, then the exception row that
 *  only speaks when something is down. */
const TODAY_DEFAULT = [
  "weather",
  "transit-next",
  "agenda",
  "vault-today",
  "todo",
  "meals",
  "briefing",
  "hand",
  "mortal",
  "health",
];

describe("unit / module registries", () => {
  it("use unique module keys per surface", () => {
    for (const defs of [LOBBY_MODULES, CENTER_MODULES]) {
      const keys = defs.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("use unique unit keys per surface", () => {
    for (const units of [LOBBY_UNITS, CENTER_UNITS]) {
      const keys = units.map((u) => u.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("give every command-center unit a zone; lobby units none", () => {
    expect(CENTER_UNITS.every((u) => u.zone)).toBe(true);
    expect(LOBBY_UNITS.every((u) => u.zone === undefined)).toBe(true);
  });

  it("declare the command-center units grouped by zone, in render order", () => {
    // The default order IS the sheet read top to bottom, so a zone must not
    // reappear further down the registry: an interleaved unit would render in its
    // zone anyway and read as scrambled in the /system panel's default listing.
    const zones = CENTER_UNITS.map((u) => u.zone);
    expect([...new Set(zones)]).toEqual(["fixed", "today"]);
    expect(zones).toEqual([...zones].sort(byZoneOrder));
  });
});

/** Sort key over the render order above — only used to prove no zone interleaves. */
function byZoneOrder(a?: string, b?: string): number {
  const order = ["fixed", "today"];
  return order.indexOf(a ?? "") - order.indexOf(b ?? "");
}

describe("normalizeLayout", () => {
  it("round-trips a full v2 config", () => {
    const c = cfg({
      lobby: ["tft"],
      center: ["health"],
      centerOrder: ["mortal"],
    });
    expect(normalizeLayout(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("reads a legacy v1 config as v2 with empty order", () => {
    expect(
      normalizeLayout({ v: 1, lobby: ["tft"], center: ["health"] }),
    ).toEqual(cfg({ lobby: ["tft"], center: ["health"] }));
  });

  it("accepts a v2 that omits the order fields (defaults empty)", () => {
    expect(normalizeLayout({ v: 2, lobby: [], center: [] })).toEqual(
      EMPTY_LAYOUT,
    );
  });

  it("drops unknown hidden + order keys — stale configs survive renames", () => {
    expect(
      normalizeLayout({
        v: 2,
        lobby: ["tft", "retired"],
        center: ["no-such-key"],
        lobbyOrder: ["github", "ghost-unit"],
        centerOrder: ["dropbox", "mortal"], // dropbox is fixed → dropped
      }),
    ).toEqual(
      cfg({ lobby: ["tft"], lobbyOrder: ["github"], centerOrder: ["mortal"] }),
    );
  });

  it("drops retired command-center keys — no migration needed", () => {
    // `tft`/`totp` left the command center, `briefing-hand` split into two units,
    // the v1 `aperture` band became the sheet bands, and `chores` dissolved into
    // the needs-doing board; a config written before any of that still reads clean.
    expect(
      normalizeLayout({
        v: 2,
        lobby: [],
        center: ["tft", "totp", "aperture", "chores", "briefing"],
        lobbyOrder: [],
        centerOrder: ["briefing-hand", "aperture", "chores", "totp", "mortal"],
      }),
    ).toEqual(cfg({ center: ["briefing"], centerOrder: ["mortal"] }));
  });

  it("degrades a pre-summary config — the reading left for /aperture", () => {
    // The home page became a summary and then became "me": the paths, the trials,
    // the seal history, then the wall, the conditions and the stones row all moved
    // to /aperture, which is not a configurable surface. A config that hides or
    // orders any of them predates a move and must read clean rather than 400 the
    // /system panel.
    expect(
      normalizeLayout({
        v: 2,
        lobby: [],
        center: [
          "aperture-paths",
          "aperture-trials",
          "aperture-record",
          "aperture-wall",
          "aperture-conditions",
          "stones",
          "briefing",
        ],
        lobbyOrder: [],
        centerOrder: [
          "aperture-wall",
          "aperture-conditions",
          "aperture-paths",
          "aperture-record",
          "stones",
          "mortal",
        ],
      }),
    ).toEqual(cfg({ center: ["briefing"], centerOrder: ["mortal"] }));
  });

  it("degrades a pre-shell config — three units left the sheet at once", () => {
    // The guide shell retired three TODAY units together: the `week` digest
    // dissolved into the paths band's evidence strips, `steps` became the body
    // path's evidence, and `networth` became the wealth path's. An owner's config
    // that hides or orders any of them predates all three, and must read clean
    // rather than 400 the /system panel — the whole point of dropping unknown keys.
    expect(
      normalizeLayout({
        v: 2,
        lobby: [],
        center: ["week", "steps", "networth", "briefing"],
        lobbyOrder: [],
        centerOrder: ["week", "networth", "health"],
      }),
    ).toEqual(cfg({ center: ["briefing"], centerOrder: ["health"] }));
  });

  it("dedupes repeated keys", () => {
    expect(
      normalizeLayout({ v: 2, lobby: ["tft", "tft"], center: [] }),
    ).toEqual(cfg({ lobby: ["tft"] }));
  });

  it("rejects unrecognizable shapes", () => {
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout({ v: 3, lobby: [], center: [] })).toBeNull();
    expect(normalizeLayout({ v: 2, lobby: "tft", center: [] })).toBeNull();
    expect(normalizeLayout({ v: 2, lobby: [42], center: [] })).toBeNull();
    expect(normalizeLayout({ v: 2, lobby: [] })).toBeNull(); // center missing
    // present-but-malformed order is a hard reject
    expect(
      normalizeLayout({ v: 2, lobby: [], center: [], lobbyOrder: "x" }),
    ).toBeNull();
  });
});

describe("hiddenSet + setHidden", () => {
  it("reads the right surface", () => {
    const c = cfg({ lobby: ["tft"], center: ["health"] });
    expect(hiddenSet(c, "lobby").has("tft")).toBe(true);
    expect(hiddenSet(c, "lobby").has("health")).toBe(false);
    expect(hiddenSet(c, "center").has("health")).toBe(true);
  });

  it("hides and shows idempotently, leaving order + the other surface alone", () => {
    let c = cfg({ centerOrder: ["mortal"] });
    c = setHidden(c, "lobby", "tft", true);
    c = setHidden(c, "lobby", "tft", true);
    expect(c.lobby).toEqual(["tft"]);
    expect(c.centerOrder).toEqual(["mortal"]); // untouched
    c = setHidden(c, "lobby", "tft", false);
    expect(c.lobby).toEqual([]);
    expect(setHidden(c, "lobby", "no-such-key", true)).toEqual(c);
  });
});

describe("orderedUnits", () => {
  it("defaults to the source order when no order is set", () => {
    expect(orderedUnits(EMPTY_LAYOUT, "lobby").map((u) => u.key)).toEqual(
      LOBBY_UNITS.map((u) => u.key),
    );
  });

  it("puts configured units first, then appends the omitted ones", () => {
    const keys = orderedUnits(
      cfg({ lobbyOrder: ["briefing", "tft"] }),
      "lobby",
    ).map((u) => u.key);
    // briefing, tft first; then the rest in default order (top, github)
    expect(keys).toEqual(["briefing", "tft", "top", "github"]);
  });

  it("keeps the fixed dropbox pinned at the front regardless of order", () => {
    const keys = orderedUnits(
      cfg({ centerOrder: ["health", "mortal"] }),
      "center",
    ).map((u) => u.key);
    expect(keys[0]).toBe("dropbox");
  });

  it("splits a surface into its zones, order preserved", () => {
    const zone = (z: Zone) =>
      orderedUnitsInZone(EMPTY_LAYOUT, "center", z).map((u) => u.key);
    expect(zone("fixed")).toEqual(["dropbox"]);
    expect(zone("today")).toEqual(TODAY_DEFAULT);
  });
});

describe("moveUnit + canMove", () => {
  it("moves a unit down within its zone", () => {
    const c = moveUnit(EMPTY_LAYOUT, "center", "weather", 1);
    expect(orderedUnitsInZone(c, "center", "today").map((u) => u.key)).toEqual([
      "transit-next",
      "weather",
      ...TODAY_DEFAULT.slice(2),
    ]);
  });

  it("moves a unit up within its zone", () => {
    const c = moveUnit(EMPTY_LAYOUT, "center", "agenda", -1);
    expect(orderedUnitsInZone(c, "center", "today").map((u) => u.key)).toEqual([
      "weather",
      "agenda",
      "transit-next",
      ...TODAY_DEFAULT.slice(3),
    ]);
  });

  it("never crosses a zone boundary", () => {
    // weather opens TODAY and health closes it: up is a no-op, not a promotion
    // into the pinned row above, and down is a no-op, not a fall off the end.
    expect(moveUnit(EMPTY_LAYOUT, "center", "weather", -1)).toEqual(
      EMPTY_LAYOUT,
    );
    expect(moveUnit(EMPTY_LAYOUT, "center", "health", 1)).toEqual(EMPTY_LAYOUT);
  });

  it("refuses to move a fixed or unknown unit", () => {
    expect(moveUnit(EMPTY_LAYOUT, "center", "dropbox", 1)).toEqual(
      EMPTY_LAYOUT,
    );
    expect(moveUnit(EMPTY_LAYOUT, "center", "ghost", 1)).toEqual(EMPTY_LAYOUT);
  });

  it("leaves the other zones untouched when reordering one", () => {
    const c = moveUnit(EMPTY_LAYOUT, "center", "agenda", -1);
    for (const z of ["fixed"] as Zone[]) {
      expect(orderedUnitsInZone(c, "center", z).map((u) => u.key)).toEqual(
        orderedUnitsInZone(EMPTY_LAYOUT, "center", z).map((u) => u.key),
      );
    }
  });

  it("canMove greys the arrows at the zone edges", () => {
    expect(canMove(EMPTY_LAYOUT, "center", "weather", -1)).toBe(false);
    expect(canMove(EMPTY_LAYOUT, "center", "weather", 1)).toBe(true);
    expect(canMove(EMPTY_LAYOUT, "center", "health", 1)).toBe(false);
    expect(canMove(EMPTY_LAYOUT, "center", "dropbox", 1)).toBe(false);
  });

  it("leads TODAY with the weather", () => {
    // A default position is part of the spec, not an accident of the registry's
    // order: the day's first row is the one thing that is true before any unlock.
    expect(orderedUnitsInZone(EMPTY_LAYOUT, "center", "today")[0].key).toBe(
      "weather",
    );
  });

  it("reorders lobby units (single zone)", () => {
    const c = moveUnit(EMPTY_LAYOUT, "lobby", "top", 1);
    expect(orderedUnits(c, "lobby").map((u) => u.key)).toEqual([
      "github",
      "top",
      "tft",
      "briefing",
    ]);
  });
});
