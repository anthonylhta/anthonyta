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

import { isValidSeq } from "./seqrule";

/** Envelope frame cap for the PUT — hundreds of items fit comfortably. */
export const TODO_MAX_BYTES = 65536;

export const MAX_ITEMS = 500;
/** Per-capture text cap. Exported because a capture composed elsewhere — a
 *  /reader headline — has to be built to fit it before it is ever offered. */
export const MAX_TEXT = 500;

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
  /** Sealed write counter (58b rollback detection) — see lib/seqrule. */
  seq?: number;
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
  if (!isValidSeq(x.seq)) return null;
  // Carry `seq` through the rebuild — dropping it would reset the rollback
  // counter on every read (the prf-label lesson).
  return {
    v: 1,
    items: x.items,
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
  };
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

/* --- captures as rendered text ---------------------------------------------
 *
 * Captures increasingly arrive carrying a URL — a /reader headline saves as
 * `title — link` — and a link you can't open is just noise in the middle of the
 * line. Splitting is done here, in the pure spine, so the rendering component
 * stays a map over parts.
 */

/** One run of a capture's text. `href` present means this part IS a link, and
 *  its `text` is what to show for it. */
export interface TextPart {
  text: string;
  href?: string;
}

/** Trailing sentence punctuation a URL almost never really ends in — "see
 *  https://x.dev." must link `https://x.dev` and leave the stop as text. The
 *  closing paren goes back too: parenthesised links are far commoner than
 *  paths that end in one. */
const TRAILING_PUNCT = /[.,;:!?)]+$/;

/**
 * Split a capture into its plain runs and the http(s) links inside it. Only an
 * explicit scheme counts: a bare `example.com` is as likely to be prose, and
 * guessing a scheme is how a link ends up pointing somewhere it shouldn't.
 * Nothing here parses markup — the parts are text either way, and only the
 * href gains meaning.
 */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(/https?:\/\/\S+/gi)) {
    const href = m[0].replace(TRAILING_PUNCT, "");
    // Nothing but a scheme survived the trim — not a link, leave it as text.
    if (!/^https?:\/\/\S/i.test(href)) continue;
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ text: href, href });
    at = m.index + href.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
