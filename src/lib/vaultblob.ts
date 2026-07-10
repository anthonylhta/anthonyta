/**
 * Pure identity/index/guard helpers + types for the E2EE vault — notes and images
 * sealed at rest under a `vault/` prefix in the private blob store, decrypted in the
 * browser (the connector wraps these around `@vercel/blob`, the bridge maps Drive
 * paths onto the ids). No `@vercel/blob` and no `next` import, no Node-only APIs, so
 * this layer runs unchanged in the window, a worker, and Node-vitest, and is
 * unit-testable on its own (mirrors lib/files + lib/crypto).
 */

import { toB64url } from "./crypto";

export const VAULT_PREFIX = "vault/";
export const VAULT_INDEX_PATH = "vault/index";

export interface VaultIndexNote {
  id: string;
  title: string;
  path: string;
  modified: string;
  preview?: string;
  h?: string;
}

export interface VaultIndexImage {
  id: string;
  name: string;
  path: string;
  h?: string;
}

export interface VaultIndex {
  v: 1;
  notes: VaultIndexNote[];
  images: VaultIndexImage[];
}

/**
 * A stable id for a vault-relative path: `base64url(SHA-256(NFC(relPath))[0..16])`,
 * always 22 chars. NFC first so a composed and a decomposed `é` name the same blob —
 * Obsidian/Drive can hand back either form. Deterministic and content-free; used
 * ONLY by the bridge to map a Drive path onto its `n-`/`i-` blob.
 */
export async function deriveId(relPath: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(relPath.normalize("NFC")),
  );
  return toB64url(new Uint8Array(digest).slice(0, 16));
}

/** The stored blob name for a note id. */
export function noteBlob(id: string): string {
  return `${VAULT_PREFIX}n-${id}.bin`;
}

/** The stored blob name for an image id. */
export function imageBlob(id: string): string {
  return `${VAULT_PREFIX}i-${id}.bin`;
}

// The only leaf shapes the raw route + store ever serve: the sealed index, or an
// `n-`/`i-` envelope named by a 22-char base64url id. Length is exact — nothing
// here adds a random suffix, unlike the inbox.
const VAULT_LEAF = /^[ni]-[A-Za-z0-9_-]{22}\.bin$/;

/** Traversal/probe guard for a STORED vault pathname — the only shape we serve. */
export function isValidVaultPath(p: string): boolean {
  if (typeof p !== "string" || !p.startsWith(VAULT_PREFIX) || p.includes(".."))
    return false;
  const leaf = p.slice(VAULT_PREFIX.length);
  return leaf === "index" || VAULT_LEAF.test(leaf);
}

function isIndexNote(x: unknown): x is VaultIndexNote {
  if (typeof x !== "object" || x === null) return false;
  const n = x as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.title === "string" &&
    typeof n.path === "string" &&
    typeof n.modified === "string"
  );
}

function isIndexImage(x: unknown): x is VaultIndexImage {
  if (typeof x !== "object" || x === null) return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.id === "string" &&
    typeof i.name === "string" &&
    typeof i.path === "string"
  );
}

/**
 * Shape guard for the decrypted index JSON (client parse). Required fields only —
 * extra keys (`h`, `preview`, future additions) ride through untouched, so an older
 * client never rejects an index a newer one wrote.
 */
export function isVaultIndex(x: unknown): x is VaultIndex {
  if (typeof x !== "object" || x === null) return false;
  const idx = x as Record<string, unknown>;
  return (
    idx.v === 1 &&
    Array.isArray(idx.notes) &&
    idx.notes.every(isIndexNote) &&
    Array.isArray(idx.images) &&
    idx.images.every(isIndexImage)
  );
}

// `preprocessNote` rewrites `![[image]]` embeds to `/vault/img/<id>`; this is the
// inverse the reader uses to fetch + decrypt one. Only that exact shape resolves —
// external `http(s)`/`data:`/anything else is left for the browser to load directly.
const VAULT_IMG = /^\/vault\/img\/([A-Za-z0-9_-]{22})$/;

/** The image id in a `/vault/img/<id>` embed src, or null for an external/other src. */
export function parseVaultImgId(src: string): string | null {
  const m = typeof src === "string" ? VAULT_IMG.exec(src) : null;
  return m ? m[1] : null;
}

/**
 * First meaningful content line of a note, for the sidebar preview (ported from the
 * old Drive connector's `previewFrom`). Strips a leading YAML frontmatter block,
 * skips blanks and headings — daily notes are templated, so the first heading is
 * identical on every note and the first prose line is the real content — then peels
 * one line's markdown markers (bullet, quote, task box, wikilink → its text,
 * emphasis) and returns it, capped at 140 chars. "" if the frontmatter ran past the
 * fetched chunk or nothing prose-like follows.
 */
export function notePreview(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  if (/^---\r?\n/.test(body)) return ""; // frontmatter longer than the chunk
  for (const raw of body.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || /^#{1,6}\s/.test(t)) continue;
    const line = t
      .replace(/^[-*+]\s+/, "") // bullets
      .replace(/^>\s?/, "") // quotes
      .replace(/^\[[ xX]\]\s*/, "") // task checkboxes
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1") // wikilinks
      .replace(/[*_`~]/g, "") // emphasis
      .trim();
    if (line) return line.slice(0, 140);
  }
  return "";
}
