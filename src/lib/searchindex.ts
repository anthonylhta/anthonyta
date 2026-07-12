/**
 * searchindex — assembling the sealed vector index from a set of notes. This is the
 * build side (run by `vault-sync`) plus the two id helpers the reader shares. It sits
 * ABOVE the pure `vectorsearch` core (chunking, quantization, the binary format) and
 * the `embedder` adapter, and holds no crypto or storage — the caller seals and
 * uploads the bytes — so it stays pure and unit-testable with a stub embedder.
 *
 * An entry id is `<noteId>#<chunkIndex>`, so a search hit maps straight back to a note
 * the `/vault` reader already knows how to open, and unchanged notes can be reused
 * across incremental builds without re-embedding.
 */

import type { Embedder } from "./embedder";
import {
  chunkText,
  normalize,
  quantize,
  type IndexEntry,
  type SearchIndex,
} from "./vectorsearch";

/** One note to index: its stable id and its decrypted markdown. */
export interface BuildNote {
  id: string;
  text: string;
}

/** Passage previews are capped so an entry stays small in the sealed blob. */
const PREVIEW_LEN = 160;

/** The note id an entry belongs to — the part before the last `#` (note ids never
 *  contain one, so a chunk suffix is unambiguous). */
export function noteIdOf(entryId: string): string {
  const hash = entryId.lastIndexOf("#");
  return hash === -1 ? entryId : entryId.slice(0, hash);
}

/** Group an index's entries by their note id — the reuse map for an incremental build. */
export function groupByNote(index: SearchIndex): Map<string, IndexEntry[]> {
  const map = new Map<string, IndexEntry[]>();
  for (const entry of index.entries) {
    const id = noteIdOf(entry.id);
    const list = map.get(id);
    if (list) list.push(entry);
    else map.set(id, [entry]);
  }
  return map;
}

export interface BuildOpts {
  chunkSize?: number;
  overlap?: number;
  previewLen?: number;
  /** noteId → its entries from the prior index, reused when the note is unchanged.
   *  The caller must only pass this when the prior index shares `embedder.dim`. */
  reuse?: Map<string, IndexEntry[]>;
  /** noteIds whose text changed since the prior index — always re-embedded. */
  changed?: Set<string>;
}

/**
 * Build (or incrementally refresh) the search index for `notes`. Each note is chunked,
 * every chunk embedded → normalized → int8-quantized into one entry. With `reuse` +
 * `changed`, an unchanged note's prior entries are carried over untouched (no
 * re-embedding), and a note absent from `notes` is dropped simply by not being
 * iterated. The result's `dim` is the embedder's, ready for `serializeIndex`.
 */
export async function buildSearchIndex(
  notes: BuildNote[],
  embedder: Embedder,
  opts: BuildOpts = {},
): Promise<SearchIndex> {
  const {
    chunkSize = 120,
    overlap = 30,
    previewLen = PREVIEW_LEN,
    reuse,
    changed,
  } = opts;

  const entries: IndexEntry[] = [];
  for (const note of notes) {
    const prior = reuse?.get(note.id);
    if (prior && !changed?.has(note.id)) {
      for (const e of prior) entries.push(e);
      continue;
    }
    const chunks = chunkText(note.text, chunkSize, overlap);
    for (let i = 0; i < chunks.length; i++) {
      const { q, scale } = quantize(normalize(await embedder.embed(chunks[i])));
      entries.push({
        id: `${note.id}#${i}`,
        q,
        scale,
        preview: chunks[i].slice(0, previewLen),
      });
    }
  }
  return { dim: embedder.dim, entries };
}
