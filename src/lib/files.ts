/**
 * Pure helpers + types for the owner-only files inbox — blobs stored under a flat
 * `inbox/` prefix in Vercel Blob (the connector, lib/inbox, wraps these around the
 * SDK). No `@vercel/blob` import and no Node-only APIs, so this layer is safe to
 * pull into a client component and unit-testable on its own (mirrors lib/github).
 */

export const INBOX_PREFIX = "inbox/";

export type FileKind =
  | "image"
  | "doc"
  | "archive"
  | "audio"
  | "video"
  | "other";

export interface InboxFile {
  pathname: string;
  url: string;
  name: string;
  size: number;
  uploadedAt: string;
  kind: FileKind;
  /** Inline content for a small text note (hydrated by lib/inbox); unset otherwise. */
  text?: string;
  /** True for an E2EE envelope blob — the client decrypts, the server can't. */
  encrypted?: boolean;
}

/** Text notes above this many bytes stay plain files — never hydrated or inlined. */
export const TEXT_NOTE_MAX = 4096;

/** Strip a segment down to the safe `[A-Za-z0-9._-]` set, collapsing dash runs. */
function scrub(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
}

/**
 * A user-supplied name → a safe LEAF filename (no prefix; the caller prepends
 * `inbox/`). Basename only, one real extension kept, everything else folded to
 * `-`, no hidden files, capped at 200 chars. Total — never throws.
 */
export function sanitizePathname(rawName: string): string {
  const base =
    typeof rawName === "string"
      ? (rawName.split(/[/\\]/).filter(Boolean).pop() ?? "")
      : "";

  // Split on the last dot, but only when a stem precedes it (so `.env` stays a
  // stem, not an extension) and the candidate looks like a real extension.
  const dot = base.lastIndexOf(".");
  const cand = dot > 0 ? base.slice(dot + 1) : "";
  const hasExt = dot > 0 && /^[A-Za-z0-9]{1,10}$/.test(cand);
  const ext = hasExt ? scrub(cand) : "";
  const rawStem = hasExt ? base.slice(0, dot) : base;

  // Collapse dot runs so the result always passes isValidPathname (".." is the
  // traversal marker it rejects, even mid-name).
  const stem = scrub(rawStem)
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
  const suffix = ext ? `.${ext}` : "";

  // Cap the whole thing at 200 by trimming the stem, never the extension.
  const maxStem = 200 - suffix.length;
  const capped =
    stem.length > maxStem ? stem.slice(0, maxStem).replace(/[-.]+$/, "") : stem;

  const out = capped + suffix;
  return capped ? out : `file${suffix}`;
}

/**
 * A typed/pasted snippet → a safe LEAF `.txt` filename (no prefix). The first 40 chars
 * become the stem, with slashes folded to `-` BEFORE sanitizing so a pasted URL keeps its
 * host instead of collapsing to a last path segment. Empty/whitespace-only → `note.txt`.
 * Always ends `.txt` and always passes `isValidPathname` once prefixed with `inbox/`.
 */
export function noteName(text: string): string {
  if (!text.trim()) return "note.txt";
  const head = text.slice(0, 40).replace(/[/\\]/g, "-");
  return sanitizePathname(head + ".txt");
}

/** A listing entry that's a small text note — inline-renderable rather than a plain file. */
export function isTextNote(f: { pathname: string; size: number }): boolean {
  return (
    f.pathname.toLowerCase().endsWith(".txt") &&
    f.size > 0 &&
    f.size <= TEXT_NOTE_MAX
  );
}

/**
 * An E2EE envelope blob (ADR 0053): every new upload is stored as
 * `inbox/e-<22 b64url>.bin`. Keys on the `e-` prefix + `.bin` suffix of the leaf
 * only — the upload route's `addRandomSuffix` inserts `-<random>` before the
 * extension, so exact length can't be trusted. Legacy plaintext rows never match:
 * nothing before this scheme produced an `e-*.bin` name.
 */
export function isEncrypted(pathname: string): boolean {
  const leaf = pathname.slice(pathname.lastIndexOf("/") + 1);
  return leaf.startsWith("e-") && leaf.endsWith(".bin");
}

/** Traversal/probe guard for a STORED pathname — the only shape we serve. */
export function isValidPathname(p: string): boolean {
  if (typeof p !== "string" || !p.startsWith(INBOX_PREFIX) || p.includes(".."))
    return false;
  return /^[A-Za-z0-9._-]{1,250}$/.test(p.slice(INBOX_PREFIX.length));
}

const KINDS: Record<string, FileKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  avif: "image", svg: "image", heic: "image",
  pdf: "doc", doc: "doc", docx: "doc", txt: "doc", md: "doc", csv: "doc",
  xlsx: "doc", pptx: "doc", rtf: "doc",
  zip: "archive", tar: "archive", gz: "archive", "7z": "archive", rar: "archive",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", flac: "audio",
  mp4: "video", mov: "video", webm: "video", mkv: "video", avi: "video",
}; // prettier-ignore

/** Bucket a pathname by its lowercased extension; no/unknown extension → "other". */
export function fileKind(pathname: string): FileKind {
  const dot = pathname.lastIndexOf(".");
  if (dot < 0) return "other";
  return KINDS[pathname.slice(dot + 1).toLowerCase()] ?? "other";
}

/**
 * The basename after `inbox/`, with Vercel Blob's `addRandomSuffix` insert removed.
 * Conservative: strip a trailing `-[A-Za-z0-9]{20,}` before the extension only when
 * present, else return the basename untouched. Never throws.
 */
export function displayName(pathname: string): string {
  const base = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  const stripped = stem.replace(/-[A-Za-z0-9]{20,}$/, "");
  return (stripped || stem) + ext;
}

/** Base-1024 size: whole bytes, one decimal above. Negative/NaN → "0 B". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Relative upload age; future/invalid timestamps read as "just now". */
export function age(iso: string, now: number = Date.now()): string {
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

/** A raw blob listing entry → the normalized shape the inbox renders. */
export function toInboxFile(raw: {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: string | Date;
}): InboxFile {
  const uploadedAt =
    raw.uploadedAt instanceof Date
      ? raw.uploadedAt.toISOString()
      : new Date(raw.uploadedAt).toISOString();
  return {
    pathname: raw.pathname,
    url: raw.url,
    name: displayName(raw.pathname),
    size: raw.size,
    uploadedAt,
    kind: fileKind(raw.pathname),
    encrypted: isEncrypted(raw.pathname),
  };
}

/** A new array, newest-first by upload time. */
export function sortInbox(files: InboxFile[]): InboxFile[] {
  return [...files].sort(
    (a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt),
  );
}
