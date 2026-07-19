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
} from "./layout";

const cfg = (o: Partial<LayoutConfig> = {}): LayoutConfig => ({
  ...EMPTY_LAYOUT,
  ...o,
});

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
});

describe("normalizeLayout", () => {
  it("round-trips a full v2 config", () => {
    const c = cfg({
      lobby: ["tft"],
      center: ["totp"],
      centerOrder: ["chores"],
    });
    expect(normalizeLayout(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("reads a legacy v1 config as v2 with empty order", () => {
    expect(normalizeLayout({ v: 1, lobby: ["tft"], center: ["totp"] })).toEqual(
      cfg({ lobby: ["tft"], center: ["totp"] }),
    );
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
        centerOrder: ["dropbox", "chores"], // dropbox is fixed → dropped
      }),
    ).toEqual(
      cfg({ lobby: ["tft"], lobbyOrder: ["github"], centerOrder: ["chores"] }),
    );
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
    const c = cfg({ lobby: ["tft"], center: ["totp"] });
    expect(hiddenSet(c, "lobby").has("tft")).toBe(true);
    expect(hiddenSet(c, "lobby").has("totp")).toBe(false);
    expect(hiddenSet(c, "center").has("totp")).toBe(true);
  });

  it("hides and shows idempotently, leaving order + the other surface alone", () => {
    let c = cfg({ centerOrder: ["chores"] });
    c = setHidden(c, "lobby", "tft", true);
    c = setHidden(c, "lobby", "tft", true);
    expect(c.lobby).toEqual(["tft"]);
    expect(c.centerOrder).toEqual(["chores"]); // untouched
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
      cfg({ centerOrder: ["totp", "week"] }),
      "center",
    ).map((u) => u.key);
    expect(keys[0]).toBe("dropbox");
  });

  it("splits a surface into its zones, order preserved", () => {
    const today = orderedUnitsInZone(EMPTY_LAYOUT, "center", "today").map(
      (u) => u.key,
    );
    expect(today).toEqual([
      "weather",
      "steps",
      "transit-next",
      "networth",
      "vault-today",
      "todo",
      "briefing-hand",
    ]);
  });
});

describe("moveUnit + canMove", () => {
  it("moves a unit down within its zone", () => {
    const c = moveUnit(EMPTY_LAYOUT, "center", "weather", 1);
    expect(orderedUnitsInZone(c, "center", "today").map((u) => u.key)).toEqual([
      "steps",
      "weather",
      "transit-next",
      "networth",
      "vault-today",
      "todo",
      "briefing-hand",
    ]);
  });

  it("moves a unit up within its zone", () => {
    const c = moveUnit(EMPTY_LAYOUT, "center", "chores", -1);
    expect(orderedUnitsInZone(c, "center", "week").map((u) => u.key)).toEqual([
      "chores",
      "week",
      "health",
      "tft",
      "totp",
    ]);
  });

  it("never crosses a zone boundary", () => {
    // weather is first in TODAY; moving it up is a no-op (not into the fixed row)
    expect(moveUnit(EMPTY_LAYOUT, "center", "weather", -1)).toEqual(
      EMPTY_LAYOUT,
    );
    // totp is last in THIS WEEK; moving it down is a no-op
    expect(moveUnit(EMPTY_LAYOUT, "center", "totp", 1)).toEqual(EMPTY_LAYOUT);
  });

  it("refuses to move a fixed or unknown unit", () => {
    expect(moveUnit(EMPTY_LAYOUT, "center", "dropbox", 1)).toEqual(
      EMPTY_LAYOUT,
    );
    expect(moveUnit(EMPTY_LAYOUT, "center", "ghost", 1)).toEqual(EMPTY_LAYOUT);
  });

  it("leaves the other zone untouched when reordering one", () => {
    const c = moveUnit(EMPTY_LAYOUT, "center", "chores", -1);
    expect(orderedUnitsInZone(c, "center", "today").map((u) => u.key)).toEqual(
      orderedUnitsInZone(EMPTY_LAYOUT, "center", "today").map((u) => u.key),
    );
  });

  it("canMove greys the arrows at the zone edges", () => {
    expect(canMove(EMPTY_LAYOUT, "center", "weather", -1)).toBe(false);
    expect(canMove(EMPTY_LAYOUT, "center", "weather", 1)).toBe(true);
    expect(canMove(EMPTY_LAYOUT, "center", "totp", 1)).toBe(false);
    expect(canMove(EMPTY_LAYOUT, "center", "dropbox", 1)).toBe(false);
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
