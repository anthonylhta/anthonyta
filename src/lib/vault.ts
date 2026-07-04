/**
 * Pure markdown preprocessing for the vault reader (no I/O — unit-tested). Strips
 * YAML frontmatter, turns Obsidian `![[image]]` embeds into markdown images that
 * point at the owner-gated `/vault/img/<id>` route, resolves `[[wikilinks]]` to
 * in-vault `/vault/<id>` links, and leaves any embed it can't resolve as a small
 * `*[embed: …]*` placeholder (e.g. a transcluded note, which the reader doesn't
 * expand). The connector-side counterparts are `getVaultIndex` / `getVaultImages`
 * (ADR 0048; pairs with the wikilink handling from ADR 0030).
 */

export interface NoteRef {
  id: string;
  title: string;
}

export interface ImageRef {
  id: string;
  path: string; // vault-relative, forward slashes
  name: string; // basename
}

/** basename of a vault path. */
function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}

/** decodeURIComponent, except a bare `%` (e.g. `100%.png`) keeps the raw path
 *  instead of throwing URIError — Obsidian doesn't always percent-encode. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function preprocessNote(
  raw: string,
  refs: { notes: NoteRef[]; images: ImageRef[] },
): string {
  // First write wins on duplicate names: `refs.notes` arrives newest-first
  // (getVaultIndex sorts it), so a duplicated title resolves to the newest note.
  const noteByTitle = new Map<string, string>();
  for (const n of refs.notes) {
    const key = n.title.toLowerCase();
    if (!noteByTitle.has(key)) noteByTitle.set(key, n.id);
  }

  // Images resolve by full vault path first, then by bare filename (Obsidian's
  // "shortest path" embeds drop the folders), both case-insensitive.
  const imgByPath = new Map<string, string>();
  const imgByName = new Map<string, string>();
  for (const im of refs.images) {
    const pathKey = im.path.toLowerCase();
    const nameKey = baseName(im.name).toLowerCase();
    if (!imgByPath.has(pathKey)) imgByPath.set(pathKey, im.id);
    if (!imgByName.has(nameKey)) imgByName.set(nameKey, im.id);
  }
  const resolveImage = (target: string): string | undefined => {
    const key = target.toLowerCase();
    return imgByPath.get(key) ?? imgByName.get(baseName(key));
  };

  let md = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  // `![[embed]]` — an image becomes a markdown image at the gated route; anything
  // else (e.g. a transcluded note) stays a placeholder.
  md = md.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner) => {
    const target = String(inner).split("|")[0].trim(); // drop `|alias` / `|size`
    const id = resolveImage(target);
    return id
      ? `![${baseName(target)}](/vault/img/${id})`
      : `*[embed: ${target}]*`;
  });

  // Standard markdown images `![alt](path)` pointing at a vault file → gated route.
  // External URLs (http/https/data) and already-rewritten routes are left alone.
  md = md.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    if (/^(https?:|data:|\/vault\/img\/)/i.test(url)) return m;
    const id = resolveImage(safeDecode(url).trim());
    return id ? `![${alt || baseName(url)}](/vault/img/${id})` : m;
  });

  // `[[wikilink]]` (optional `|alias`) → in-vault link, or just the label if unknown.
  // A `#heading` / `^block` suffix targets a spot INSIDE the note (`#`/`^` are
  // illegal in Obsidian titles), so it's stripped for the lookup; the reader has
  // no anchors, so the link lands on the note top and the label keeps the suffix.
  md = md.replace(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
    (_m, name, alias) => {
      const written = String(name).trim();
      const title = written.split(/[#^]/)[0].trim();
      const id = title ? noteByTitle.get(title.toLowerCase()) : undefined;
      const label = String(alias ?? written).trim();
      return id ? `[${label}](/vault/${id})` : label;
    },
  );

  return md;
}
