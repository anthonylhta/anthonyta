import { describe, expect, it } from "vitest";
import {
  CENTER_MODULES,
  EMPTY_LAYOUT,
  LOBBY_MODULES,
  hiddenSet,
  normalizeLayout,
  setHidden,
  type LayoutConfig,
} from "./layout";

describe("module registries", () => {
  it("use unique keys per surface", () => {
    for (const defs of [LOBBY_MODULES, CENTER_MODULES]) {
      const keys = defs.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("normalizeLayout", () => {
  it("round-trips a valid config", () => {
    const cfg: LayoutConfig = { v: 1, lobby: ["tft"], center: ["totp"] };
    expect(normalizeLayout(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });

  it("accepts the empty config", () => {
    expect(normalizeLayout({ v: 1, lobby: [], center: [] })).toEqual(
      EMPTY_LAYOUT,
    );
  });

  it("drops unknown keys instead of failing — stale configs survive renames", () => {
    expect(
      normalizeLayout({
        v: 1,
        lobby: ["tft", "retired-module"],
        center: ["no-such-key"],
      }),
    ).toEqual({ v: 1, lobby: ["tft"], center: [] });
  });

  it("dedupes repeated keys", () => {
    expect(
      normalizeLayout({ v: 1, lobby: ["tft", "tft"], center: [] }),
    ).toEqual({ v: 1, lobby: ["tft"], center: [] });
  });

  it("rejects unrecognizable shapes", () => {
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout({ v: 2, lobby: [], center: [] })).toBeNull();
    expect(normalizeLayout({ v: 1, lobby: "tft", center: [] })).toBeNull();
    expect(normalizeLayout({ v: 1, lobby: [42], center: [] })).toBeNull();
    expect(normalizeLayout({ v: 1, lobby: [] })).toBeNull();
    expect(
      normalizeLayout({
        v: 1,
        lobby: Array.from({ length: 51 }, () => "tft"),
        center: [],
      }),
    ).toBeNull();
  });
});

describe("hiddenSet", () => {
  it("reads the right surface", () => {
    const cfg: LayoutConfig = { v: 1, lobby: ["tft"], center: ["totp"] };
    expect(hiddenSet(cfg, "lobby").has("tft")).toBe(true);
    expect(hiddenSet(cfg, "lobby").has("totp")).toBe(false);
    expect(hiddenSet(cfg, "center").has("totp")).toBe(true);
  });
});

describe("setHidden", () => {
  it("hides and shows idempotently", () => {
    let cfg = EMPTY_LAYOUT;
    cfg = setHidden(cfg, "lobby", "tft", true);
    cfg = setHidden(cfg, "lobby", "tft", true);
    expect(cfg.lobby).toEqual(["tft"]);
    cfg = setHidden(cfg, "lobby", "tft", false);
    expect(cfg.lobby).toEqual([]);
  });

  it("no-ops on unknown keys and leaves the other surface alone", () => {
    const cfg = setHidden(EMPTY_LAYOUT, "lobby", "no-such-key", true);
    expect(cfg).toEqual(EMPTY_LAYOUT);
    const c2 = setHidden(EMPTY_LAYOUT, "center", "tft", true);
    expect(c2.lobby).toEqual([]);
    expect(c2.center).toEqual(["tft"]);
  });
});
