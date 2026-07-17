/**
 * todo — the pure spine of the E2EE quick-capture list (roadmap 53). Typed
 * quick thoughts finally get a home: one sealed envelope at `meta/todo` (the
 * fin pattern's fourth outing), decrypted and edited only in the browser
 * behind the vault unlock. The server moves ciphertext it never parses, so
 * every size/shape cap here is CLIENT-side law — the route can only check the
 * envelope frame.
 *
 * Ordering is structural, not sorted: `addItem` PREPENDS, so the array is
 * newest-first by construction; `openItems` floats pinned entries with a
 * stable sort and otherwise preserves that order. Nothing ever re-sorts by
 * timestamp — `created` is display metadata, not a key.
 */

/** Envelope frame cap for the PUT — hundreds of items fit comfortably. */
export const TODO_MAX_BYTES = 65536;

export const MAX_ITEMS = 500;
const MAX_TEXT = 500;

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  /** ISO capture timestamp (the device clock is the owner's clock). */
  created: string;
  pinned: boolean;
}

export interface TodoConfig {
  v: 1;
  items: TodoItem[];
}

export const EMPTY_TODO_CONFIG: TodoConfig = { v: 1, items: [] };

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isItem(x: unknown): x is TodoItem {
  return (
    isObj(x) &&
    typeof x.id === "string" &&
    x.id.length > 0 &&
    x.id.length <= 64 &&
    typeof x.text === "string" &&
    x.text.length > 0 &&
    x.text.length <= MAX_TEXT &&
    typeof x.done === "boolean" &&
    typeof x.pinned === "boolean" &&
    typeof x.created === "string" &&
    x.created.length <= 64
  );
}

/** Strict parse of a decrypted config — null on anything unrecognizable, so a
 *  tampered payload reads as "cannot decrypt", never as an empty list. */
export function normalizeTodoConfig(x: unknown): TodoConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!Array.isArray(x.items) || x.items.length > MAX_ITEMS) return null;
  if (!x.items.every(isItem)) return null;
  return { v: 1, items: x.items };
}

/**
 * Prepend a capture (newest first). Text is trimmed and clipped to the cap;
 * an empty capture is a no-op. At the item cap the oldest DONE item is
 * evicted to make room — completed items are the only safe ballast; with
 * nothing done, the oldest capture goes (a 500-deep backlog has bigger
 * problems than tail loss).
 */
export function addItem(
  cfg: TodoConfig,
  id: string,
  text: string,
  created: string,
): TodoConfig {
  const clean = text.trim().slice(0, MAX_TEXT);
  if (!clean) return cfg;
  let items = [
    { id, text: clean, done: false, created, pinned: false },
    ...cfg.items,
  ];
  if (items.length > MAX_ITEMS) {
    const lastDone = items.map((i) => i.done).lastIndexOf(true);
    items =
      lastDone >= 0
        ? items.filter((_, idx) => idx !== lastDone)
        : items.slice(0, MAX_ITEMS);
  }
  return { v: 1, items };
}

export function setDone(
  cfg: TodoConfig,
  id: string,
  done: boolean,
): TodoConfig {
  return {
    v: 1,
    items: cfg.items.map((i) => (i.id === id ? { ...i, done } : i)),
  };
}

export function setPinned(
  cfg: TodoConfig,
  id: string,
  pinned: boolean,
): TodoConfig {
  return {
    v: 1,
    items: cfg.items.map((i) => (i.id === id ? { ...i, pinned } : i)),
  };
}

export function removeItem(cfg: TodoConfig, id: string): TodoConfig {
  return { v: 1, items: cfg.items.filter((i) => i.id !== id) };
}

/** Drop every completed item — the list's only bulk housekeeping. */
export function clearDone(cfg: TodoConfig): TodoConfig {
  return { v: 1, items: cfg.items.filter((i) => !i.done) };
}

/** Open items, pinned first; insertion (newest-first) order within groups. */
export function openItems(cfg: TodoConfig): TodoItem[] {
  return cfg.items
    .filter((i) => !i.done)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function doneCount(cfg: TodoConfig): number {
  return cfg.items.filter((i) => i.done).length;
}
