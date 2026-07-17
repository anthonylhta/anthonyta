import { describe, expect, it } from "vitest";
import {
  EMPTY_TODO_CONFIG,
  MAX_ITEMS,
  addItem,
  clearDone,
  doneCount,
  normalizeTodoConfig,
  openItems,
  removeItem,
  setDone,
  setPinned,
  type TodoConfig,
  type TodoItem,
} from "./todo";

const item = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: "a",
  text: "buy milk",
  done: false,
  created: "2026-07-17T08:00:00.000Z",
  pinned: false,
  ...over,
});

describe("normalizeTodoConfig", () => {
  it("round-trips a valid config", () => {
    const cfg: TodoConfig = { v: 1, items: [item()] };
    expect(normalizeTodoConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });

  it("accepts the empty config", () => {
    expect(normalizeTodoConfig({ v: 1, items: [] })).toEqual(EMPTY_TODO_CONFIG);
  });

  it("rejects anything unrecognizable rather than degrading to empty", () => {
    expect(normalizeTodoConfig(null)).toBeNull();
    expect(normalizeTodoConfig({ v: 2, items: [] })).toBeNull();
    expect(normalizeTodoConfig({ v: 1 })).toBeNull();
    expect(normalizeTodoConfig({ v: 1, items: [{}] })).toBeNull();
    expect(
      normalizeTodoConfig({ v: 1, items: [item({ text: "" })] }),
    ).toBeNull();
    expect(
      normalizeTodoConfig({ v: 1, items: [item({ text: "x".repeat(501) })] }),
    ).toBeNull();
    expect(
      normalizeTodoConfig({ v: 1, items: [item({ done: "yes" as never })] }),
    ).toBeNull();
  });

  it("caps the item count", () => {
    const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) =>
      item({ id: `i${i}` }),
    );
    expect(normalizeTodoConfig({ v: 1, items })).toBeNull();
  });
});

describe("addItem", () => {
  it("prepends (newest first), trimming the text", () => {
    let cfg = addItem(EMPTY_TODO_CONFIG, "a", "  first  ", "t1");
    cfg = addItem(cfg, "b", "second", "t2");
    expect(cfg.items.map((i) => i.text)).toEqual(["second", "first"]);
  });

  it("ignores an empty capture", () => {
    expect(addItem(EMPTY_TODO_CONFIG, "a", "   ", "t")).toEqual(
      EMPTY_TODO_CONFIG,
    );
  });

  it("clips oversized text instead of failing", () => {
    const cfg = addItem(EMPTY_TODO_CONFIG, "a", "x".repeat(600), "t");
    expect(cfg.items[0].text).toHaveLength(500);
  });

  it("evicts the oldest done item at the cap", () => {
    const items = Array.from({ length: MAX_ITEMS }, (_, i) =>
      item({ id: `i${i}`, done: i === MAX_ITEMS - 2 }),
    );
    const cfg = addItem({ v: 1, items }, "new", "capture", "t");
    expect(cfg.items).toHaveLength(MAX_ITEMS);
    expect(cfg.items[0].id).toBe("new");
    expect(cfg.items.some((i) => i.id === `i${MAX_ITEMS - 2}`)).toBe(false);
  });

  it("drops the oldest capture at the cap when nothing is done", () => {
    const items = Array.from({ length: MAX_ITEMS }, (_, i) =>
      item({ id: `i${i}` }),
    );
    const cfg = addItem({ v: 1, items }, "new", "capture", "t");
    expect(cfg.items).toHaveLength(MAX_ITEMS);
    expect(cfg.items[0].id).toBe("new");
    expect(cfg.items.some((i) => i.id === `i${MAX_ITEMS - 1}`)).toBe(false);
  });
});

describe("item mutations", () => {
  const cfg: TodoConfig = {
    v: 1,
    items: [item({ id: "a" }), item({ id: "b" })],
  };

  it("setDone / setPinned target by id and leave the rest", () => {
    expect(setDone(cfg, "a", true).items.map((i) => i.done)).toEqual([
      true,
      false,
    ]);
    expect(setPinned(cfg, "b", true).items.map((i) => i.pinned)).toEqual([
      false,
      true,
    ]);
    expect(setDone(cfg, "nope", true)).toEqual(cfg);
  });

  it("removeItem drops by id", () => {
    expect(removeItem(cfg, "a").items.map((i) => i.id)).toEqual(["b"]);
  });

  it("clearDone keeps only open items and doneCount counts the rest", () => {
    const mixed = setDone(cfg, "a", true);
    expect(doneCount(mixed)).toBe(1);
    expect(clearDone(mixed).items.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("openItems", () => {
  it("floats pinned entries, keeps newest-first order within groups", () => {
    const cfg: TodoConfig = {
      v: 1,
      items: [
        item({ id: "new" }),
        item({ id: "pinned-new", pinned: true }),
        item({ id: "done", done: true }),
        item({ id: "pinned-old", pinned: true }),
        item({ id: "old" }),
      ],
    };
    expect(openItems(cfg).map((i) => i.id)).toEqual([
      "pinned-new",
      "pinned-old",
      "new",
      "old",
    ]);
  });
});
