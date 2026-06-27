import { unstable_cache } from "next/cache";
import { driveToken } from "@/lib/google";

/**
 * vault connector — reads a STRICTLY PRIVATE Obsidian vault from a Drive folder
 * shared read-only with the service account (`VAULT_FOLDER_ID`). Returns an index
 * of markdown notes; a note's content is fetched on demand by id.
 *
 * READ-ONLY, fully guarded — missing env/creds (CI) or any failure returns
 * `[]`/`null`. OWNER-ONLY by contract: every caller MUST gate on the session
 * before invoking these (the `/vault` route `notFound()`s for guests, so vault
 * data never reaches a non-authed response). Skips `.obsidian`/`.trash`. Markdown
 * builds the note index; image files are indexed separately (`getVaultImages`) so
 * the reader can resolve `![[image]]` embeds to the owner-gated image route (ADR 0048).
 */

export interface VaultNote {
  id: string; // Drive file id
  title: string; // filename without .md
  path: string; // vault-relative path, e.g. "Weekly Planners/2026-W25.md"
  modified: string; // ISO
  preview?: string; // first content line (a small byte-range read), for the index
}

export interface VaultImage {
  id: string; // Drive file id
  name: string; // filename, e.g. "20260620_101500.jpg"
  path: string; // vault-relative path, e.g. "Journals/Images/2026-06-20/20260620_101500.jpg"
  mimeType: string; // e.g. "image/jpeg"
}

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SKIP_FOLDERS = new Set([".obsidian", ".trash"]);

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
};

interface VaultTree {
  notes: VaultNote[];
  images: VaultImage[];
}

async function listFolder(
  token: string,
  folderId: string,
  prefix: string,
  tree: VaultTree,
): Promise<void> {
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url =
      `${DRIVE}?q=${q}&pageSize=1000` +
      `&fields=nextPageToken,files(id,name,mimeType,modifiedTime)` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error("[connector:vault] list failed", res.status);
      return;
    }
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: DriveFile[];
    };
    for (const f of data.files ?? []) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        if (SKIP_FOLDERS.has(f.name)) continue;
        await listFolder(token, f.id, `${prefix}${f.name}/`, tree);
      } else if (f.mimeType === "text/markdown" || f.name.endsWith(".md")) {
        tree.notes.push({
          id: f.id,
          title: f.name.replace(/\.md$/, ""),
          path: `${prefix}${f.name}`,
          modified: f.modifiedTime,
        });
      } else if (f.mimeType.startsWith("image/")) {
        tree.images.push({
          id: f.id,
          name: f.name,
          path: `${prefix}${f.name}`,
          mimeType: f.mimeType,
        });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
}

/** Pull the first real line out of a note's opening bytes (no frontmatter, no
 *  markdown markers). Returns "" if the frontmatter ran past the fetched chunk. */
function previewFrom(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  if (/^---\r?\n/.test(body)) return ""; // frontmatter longer than the chunk
  for (const raw of body.split(/\r?\n/)) {
    const t = raw.trim();
    // Skip blanks and headings: daily notes are templated, so the first heading
    // is identical on every note — the first prose line is the real content.
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

/** First ~2KB of a note (byte-range), reduced to a one-line preview. "" on failure. */
async function fetchPreview(token: string, id: string): Promise<string> {
  try {
    const res = await fetch(`${DRIVE}/${encodeURIComponent(id)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-2047" },
    });
    if (!res.ok) return ""; // 200/206 are ok; anything else → skip
    return previewFrom(await res.text());
  } catch {
    return "";
  }
}

/** Run `fn` over `items` with at most `limit` in flight (Drive-friendly). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** A note's preview, cached by (id, modifiedTime) and never time-expired — so an
 *  index rebuild only re-reads previews for notes that actually changed (a new
 *  modifiedTime = a new cache key). Unchanged notes are pure cache hits. */
function cachedPreview(token: string, n: VaultNote): Promise<string> {
  return unstable_cache(
    () => fetchPreview(token, n.id),
    ["vault-prev", n.id, n.modified],
    { tags: ["vault"] },
  )();
}

async function buildTree(): Promise<VaultTree> {
  const token = await driveToken();
  const folderId = process.env.VAULT_FOLDER_ID;
  if (!token || !folderId) return { notes: [], images: [] };
  const tree: VaultTree = { notes: [], images: [] };
  await listFolder(token, folderId, "", tree);
  tree.notes.sort((a, b) => b.modified.localeCompare(a.modified)); // newest first
  const previews = await mapLimit(tree.notes, 24, (n) =>
    cachedPreview(token, n),
  );
  tree.notes.forEach((n, i) => {
    n.preview = previews[i];
  });
  return tree;
}

// Heavier build (a byte-range read per note for previews), so cache it longer.
const loadTree = unstable_cache(buildTree, ["vault-tree"], {
  revalidate: 1800,
  tags: ["vault"],
});

/** The note index (newest first). `[]` on any failure. Gate on the session first. */
export async function getVaultIndex(): Promise<VaultNote[]> {
  try {
    return (await loadTree()).notes;
  } catch (err) {
    console.error("[connector:vault] index failed", err);
    return [];
  }
}

/** The vault's image files, for resolving `![[image]]` embeds to the owner-gated
 *  image route (ADR 0048). `[]` on any failure. Gate on the session first. */
export async function getVaultImages(): Promise<VaultImage[]> {
  try {
    return (await loadTree()).images;
  } catch (err) {
    console.error("[connector:vault] images failed", err);
    return [];
  }
}

async function fetchNoteText(id: string): Promise<string | null> {
  const token = await driveToken();
  if (!token) return null;
  const res = await fetch(`${DRIVE}/${encodeURIComponent(id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error("[connector:vault] read failed", res.status);
    return null;
  }
  return res.text();
}

/** Raw markdown for one note id (frontmatter intact). `null` on failure / bad id.
 *  Validates the id shape so a route param can't be used to probe arbitrary URLs.
 *  Keyed by (id, modified) so an edited note refreshes and a revisit is a cache hit. */
export async function getVaultNote(
  id: string,
  modified?: string,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  try {
    return await unstable_cache(
      () => fetchNoteText(id),
      ["vault-note", id, modified ?? ""],
      { revalidate: 1800, tags: ["vault"] },
    )();
  } catch (err) {
    console.error("[connector:vault] note failed", err);
    return null;
  }
}
