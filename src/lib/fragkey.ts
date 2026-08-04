/**
 * fragkey — fragment-key hygiene for share links. The share URL's `#fragment`
 * never reaches the server (that is the whole design), but the browser is its
 * own observer: a visited link lands in HISTORY on the recipient's device, key
 * and all, and history sync can carry it to every signed-in browser they own.
 *
 * The remedy is capture-then-strip: the viewer reads the fragment once, rewrites
 * the history entry without it (`history.replaceState`), and parks the key in a
 * short-lived sessionStorage handoff so a same-tab reload can still decrypt.
 * After that, history holds only the bare `/s/<id>` — which without its key is
 * ciphertext-shaped noise.
 *
 * This module is the pure half: fragment parsing, URL stripping, and the handoff
 * record. The impure lines (touching `history` and `sessionStorage`) stay in the
 * viewer component. Time is injected everywhere so expiry is testable to the
 * millisecond, and every malformed input fails toward "no key" — a damaged
 * handoff must read as gone, never as some other key.
 */

/** A share key's fragment form: 32 raw bytes, base64url, unpadded → 43 chars. */
const FRAGMENT_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The validated key from a `location.hash`-shaped string (leading `#` optional),
 * or null. Anything not exactly one well-formed key is null — a truncated copy
 * should read as "missing its key", not round-trip into a doomed decrypt.
 */
export function parseKeyFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return FRAGMENT_KEY_RE.test(raw) ? raw : null;
}

/** The href with its fragment removed — what the history entry is rewritten to.
 *  Plain string surgery: everything after the first `#` IS the fragment. */
export function stripFragment(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

/** How long a parked key survives in the handoff before a reload stops working.
 *  sessionStorage already dies with the tab; this bounds the long-lived-tab case. */
export const HANDOFF_TTL_MS = 15 * 60 * 1000;

/** The sessionStorage slot for one share's parked key. */
export function handoffSlot(id: string): string {
  return `sharekey:${id}`;
}

/** Serialize a parked key with its expiry. */
export function buildHandoff(key: string, nowMs: number): string {
  return JSON.stringify({ v: 1, k: key, exp: nowMs + HANDOFF_TTL_MS });
}

/**
 * The key from a stored handoff, or null when it is expired, malformed, or not
 * a handoff at all. A non-finite expiry fails toward null — corrupted storage
 * must never produce an immortal key.
 */
export function readHandoff(
  stored: string | null,
  nowMs: number,
): string | null {
  if (!stored) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const h = parsed as { v?: unknown; k?: unknown; exp?: unknown };
  if (h.v !== 1) return null;
  if (typeof h.k !== "string" || !FRAGMENT_KEY_RE.test(h.k)) return null;
  if (typeof h.exp !== "number" || !Number.isFinite(h.exp)) return null;
  return nowMs < h.exp ? h.k : null;
}
