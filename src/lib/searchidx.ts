/**
 * searchidx — the pure spine of the vault's encrypted full-text search. Character
 * TRIGRAMS over the decrypted corpus: one mechanism that indexes English and 日本語
 * alike (no dictionaries, no language detection, no model), so substring matching
 * falls out of intersecting posting lists. The built index is just another secret —
 * the caller seals its bytes under the master key like every other vault blob, the
 * server stores opaque ciphertext, and search runs entirely in the browser after the
 * unlock. This module holds no crypto and no storage, so it runs unchanged in the
 * window, a worker, and Node-vitest, and is exhaustively unit-testable.
 *
 * Why trigrams (superseding the vector/embedder spine): no model download, no CSP
 * 'wasm-unsafe-eval', bilingual by construction, and true substring matching (Ctrl-F
 * semantics) instead of approximate vocabulary overlap.
 *
 * The index is the inverted map `trigram -> (docId -> positions)`, plus a tiny doc
 * table (`docId -> titleLen`). A document's stream is its normalized title followed
 * by a one-slot gap and its normalized body; a position is the code-point offset into
 * that stream, so a match whose start lands before `titleLen` is a title hit (ranked
 * higher). Positions are capped per (trigram, doc) so a pathologically repetitive note
 * can't balloon the blob. Incremental `updateDoc`/`removeDoc` touch only their own
 * doc's postings; canonical serialization sorts docs by id and trigrams by code order,
 * so an incrementally-built index is byte-identical to one rebuilt from scratch —
 * the invariant that makes incrementality trustworthy (and the property test's target).
 */

// --- format + tuning constants -----------------------------------------------

const MAGIC = "TGX1";
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);

/** Serialized-format version, gated on read so a future layout can migrate. */
export const INDEX_VERSION = 1;
/** Character n-gram width. */
export const TRIGRAM = 3;
/** Max positions stored per (trigram, doc). Bounds the blob against a note that
 *  repeats one trigram thousands of times; a real note never approaches it. */
export const MAX_POSITIONS_PER_TOKEN = 32;
/** How much a title occurrence outweighs a body one in the tf score. */
export const TITLE_BOOST = 5;

const enc = new TextEncoder();
const dec = new TextDecoder();

// --- tokenizer ----------------------------------------------------------------

/**
 * Fold text to its match form: NFKC (so full-width ＡＢＣ / half-width, and composed
 * vs decomposed accents collapse), case-folded, whitespace runs squeezed to one space
 * and trimmed. The single normalization both the index build and every query pass
 * through, so they always agree.
 */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Code points (not UTF-16 units) so a trigram never splits a surrogate pair. */
function codePoints(s: string): string[] {
  return Array.from(s);
}

/**
 * The trigrams of `text` after normalization, in order (duplicates kept). Exposed for
 * the tokenizer tests; the index build uses the position-aware path below.
 */
export function trigrams(text: string): string[] {
  const cps = codePoints(normalizeText(text));
  const out: string[] = [];
  for (let i = 0; i + TRIGRAM <= cps.length; i++)
    out.push(cps[i] + cps[i + 1] + cps[i + 2]);
  return out;
}

// --- index model --------------------------------------------------------------

/** One document to index: a stable id, its title, and its decrypted body. */
export interface IndexDoc {
  id: string;
  title: string;
  text: string;
}

export interface DocMeta {
  /** Code-point length of the normalized title — a position `< titleLen` is a title hit. */
  titleLen: number;
}

/**
 * The in-memory index. `inverted` is authoritative and serialized; `docTokens` is the
 * per-doc token set that makes removal O(its own postings); `docMeta` is the doc table.
 * All three are kept consistent by `updateDoc`/`removeDoc`, and `docTokens` is rebuilt
 * from `inverted` on deserialize (it isn't part of the bytes).
 */
export interface TrigramIndex {
  version: number;
  docMeta: Map<string, DocMeta>;
  docTokens: Map<string, Set<string>>;
  inverted: Map<string, Map<string, number[]>>;
}

export function emptyIndex(): TrigramIndex {
  return {
    version: INDEX_VERSION,
    docMeta: new Map(),
    docTokens: new Map(),
    inverted: new Map(),
  };
}

/** Append one code-point run's trigrams to `post`, offset into the doc stream, capped. */
function addRun(
  post: Map<string, number[]>,
  cps: string[],
  offset: number,
): void {
  for (let i = 0; i + TRIGRAM <= cps.length; i++) {
    const tok = cps[i] + cps[i + 1] + cps[i + 2];
    let arr = post.get(tok);
    if (!arr) {
      arr = [];
      post.set(tok, arr);
    }
    if (arr.length < MAX_POSITIONS_PER_TOKEN) arr.push(offset + i);
  }
}

/**
 * A doc's postings: `trigram -> ascending, capped positions` into the stream
 * `normalize(title) | gap | normalize(body)`. The one-slot gap between the runs means
 * no trigram bridges title and body, so every occurrence lies wholly in one — and a
 * start `< titleLen` is unambiguously a title hit.
 */
function docPostings(doc: IndexDoc): {
  post: Map<string, number[]>;
  titleLen: number;
} {
  const tc = codePoints(normalizeText(doc.title));
  const bc = codePoints(normalizeText(doc.text));
  const post = new Map<string, number[]>();
  addRun(post, tc, 0);
  addRun(post, bc, tc.length + 1);
  return { post, titleLen: tc.length };
}

/**
 * Insert or replace a document. An existing id is removed first, so the call is a
 * clean upsert that touches only this doc's trigrams — never the rest of the index.
 */
export function updateDoc(index: TrigramIndex, doc: IndexDoc): void {
  if (index.docMeta.has(doc.id)) removeDoc(index, doc.id);
  const { post, titleLen } = docPostings(doc);
  const tokens = new Set<string>();
  for (const [tok, pos] of post) {
    tokens.add(tok);
    let byId = index.inverted.get(tok);
    if (!byId) {
      byId = new Map();
      index.inverted.set(tok, byId);
    }
    byId.set(doc.id, pos);
  }
  index.docTokens.set(doc.id, tokens);
  index.docMeta.set(doc.id, { titleLen });
}

/** Drop a document, pruning only its trigrams (and any that become empty). */
export function removeDoc(index: TrigramIndex, id: string): void {
  const tokens = index.docTokens.get(id);
  if (!tokens) return;
  for (const tok of tokens) {
    const byId = index.inverted.get(tok);
    if (byId) {
      byId.delete(id);
      if (byId.size === 0) index.inverted.delete(tok);
    }
  }
  index.docTokens.delete(id);
  index.docMeta.delete(id);
}

/** Build an index from scratch. `updateDoc` per doc, so it shares the upsert path. */
export function buildIndex(docs: IndexDoc[]): TrigramIndex {
  const index = emptyIndex();
  for (const doc of docs) updateDoc(index, doc);
  return index;
}

/** Size accounting: doc / distinct-trigram / total-position counts. */
export function indexStats(index: TrigramIndex): {
  docs: number;
  tokens: number;
  positions: number;
} {
  let positions = 0;
  for (const byId of index.inverted.values())
    for (const pos of byId.values()) positions += pos.length;
  return {
    docs: index.docMeta.size,
    tokens: index.inverted.size,
    positions,
  };
}

// --- query --------------------------------------------------------------------

export interface QueryHit {
  id: string;
  /** tf across title + body, with title occurrences weighted by TITLE_BOOST. */
  score: number;
}

/**
 * Rank documents whose title or body contains `text` as a substring, best first. A
 * query of 3+ characters intersects the posting lists of its consecutive trigrams and
 * positionally verifies each candidate (so a doc that merely scatters the trigrams is
 * rejected — no false positives); a shorter query falls back to a trigram-prefix scan.
 * Ties break by id for a stable order; returns at most `k` hits.
 */
export function query(index: TrigramIndex, text: string, k = 20): QueryHit[] {
  const qc = codePoints(normalizeText(text));
  if (qc.length === 0 || k <= 0) return [];
  const scores =
    qc.length < TRIGRAM ? prefixScan(index, qc) : trigramSearch(index, qc);
  const hits: QueryHit[] = [];
  for (const [id, score] of scores) if (score > 0) hits.push({ id, score });
  hits.sort(
    (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return hits.slice(0, k);
}

/** Exact-substring path for a 3+ char query: intersect + positionally verify. */
function trigramSearch(index: TrigramIndex, qc: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  const tris: string[] = [];
  for (let j = 0; j + TRIGRAM <= qc.length; j++)
    tris.push(qc[j] + qc[j + 1] + qc[j + 2]);

  // Every query trigram must exist somewhere, or nothing contains the substring.
  const maps: Map<string, number[]>[] = [];
  for (const t of tris) {
    const m = index.inverted.get(t);
    if (!m) return scores;
    maps.push(m);
  }

  // Candidate docs = intersection of the trigrams' doc sets; walk the smallest.
  let smallest = 0;
  for (let i = 1; i < maps.length; i++)
    if (maps[i].size < maps[smallest].size) smallest = i;

  for (const id of maps[smallest].keys()) {
    let inAll = true;
    for (const m of maps)
      if (!m.has(id)) {
        inAll = false;
        break;
      }
    if (!inAll) continue;

    // A start position p is a real occurrence iff every trigram j sits at p+j.
    const starts = maps[0].get(id)!;
    const sets = maps.map((m) => new Set(m.get(id)!));
    const titleLen = index.docMeta.get(id)!.titleLen;
    let total = 0;
    let title = 0;
    for (const p of starts) {
      let ok = true;
      for (let j = 1; j < maps.length; j++)
        if (!sets[j].has(p + j)) {
          ok = false;
          break;
        }
      if (ok) {
        total++;
        if (p < titleLen) title++;
      }
    }
    if (total > 0) scores.set(id, total + TITLE_BOOST * title);
  }
  return scores;
}

/** Short-query (<3 chars) fallback: union the docs of every trigram that begins with
 *  the query, scored by matched-position count (title-weighted). */
function prefixScan(index: TrigramIndex, qc: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [token, byId] of index.inverted) {
    const tc = codePoints(token);
    let starts = true;
    for (let i = 0; i < qc.length; i++)
      if (tc[i] !== qc[i]) {
        starts = false;
        break;
      }
    if (!starts) continue;
    for (const [id, pos] of byId) {
      const titleLen = index.docMeta.get(id)!.titleLen;
      let title = 0;
      for (const p of pos) if (p < titleLen) title++;
      const add = pos.length + TITLE_BOOST * title;
      scores.set(id, (scores.get(id) ?? 0) + add);
    }
  }
  return scores;
}

// --- highlighting (UI helper, pure) -------------------------------------------

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * Split `text` into alternating hit / non-hit segments around every case-insensitive
 * occurrence of `queryText`, for rendering a highlighted snippet. Matching is a plain
 * case-fold on the display string (length-preserving in practice), so offsets map back
 * to the original — a hit here is a subset of what the NFKC index matches, so a result
 * with no display hit (e.g. a full/half-width mismatch, or a body-only match) simply
 * renders unhighlighted rather than wrong.
 */
export function highlightSegments(
  text: string,
  queryText: string,
): HighlightSegment[] {
  if (!text) return [];
  const q = queryText.toLowerCase();
  if (!q) return [{ text, hit: false }];
  const hay = text.toLowerCase();
  const segs: HighlightSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const at = hay.indexOf(q, i);
    if (at === -1) {
      segs.push({ text: text.slice(i), hit: false });
      break;
    }
    if (at > i) segs.push({ text: text.slice(i, at), hit: false });
    segs.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  return segs;
}

// --- serialization ------------------------------------------------------------
//
// Big-endian, so bytes are stable across machines. Canonical order — docs by id,
// trigrams by string order, postings by doc index, positions ascending — makes an
// incrementally-built index serialize identically to a rebuilt one.
//
// [ "TGX1" | version:u32 | docCount:u32 ]
//   per doc (id order):   [ idLen:u16 | id:utf8 | titleLen:u32 ]
// [ tokenCount:u32 ]
//   per trigram (order):  [ tokLen:u8 | tok:utf8 | postingCount:u32 ]
//     per posting (doc):  [ docIndex:u32 | posCount:u32 | positions:u32× ]

/** Serialize to the compact byte layout that gets sealed. */
export function serializeIndex(index: TrigramIndex): Uint8Array {
  const ids = [...index.docMeta.keys()].sort();
  const idIndex = new Map<string, number>();
  ids.forEach((id, i) => idIndex.set(id, i));
  const idBytes = ids.map((id) => enc.encode(id));

  const tokens = [...index.inverted.keys()].sort();
  const tokBytes = tokens.map((t) => enc.encode(t));
  const perToken = tokens.map((tok) =>
    [...index.inverted.get(tok)!.entries()]
      .map(([id, pos]) => ({ di: idIndex.get(id)!, pos }))
      .sort((a, b) => a.di - b.di),
  );

  let size = MAGIC_BYTES.length + 4 + 4;
  for (let i = 0; i < ids.length; i++) size += 2 + idBytes[i].length + 4;
  size += 4;
  for (let t = 0; t < tokens.length; t++) {
    size += 1 + tokBytes[t].length + 4;
    for (const p of perToken[t]) size += 4 + 4 + 4 * p.pos.length;
  }

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  out.set(MAGIC_BYTES, o);
  o += MAGIC_BYTES.length;
  view.setUint32(o, index.version);
  o += 4;
  view.setUint32(o, ids.length);
  o += 4;
  for (let i = 0; i < ids.length; i++) {
    view.setUint16(o, idBytes[i].length);
    o += 2;
    out.set(idBytes[i], o);
    o += idBytes[i].length;
    view.setUint32(o, index.docMeta.get(ids[i])!.titleLen);
    o += 4;
  }
  view.setUint32(o, tokens.length);
  o += 4;
  for (let t = 0; t < tokens.length; t++) {
    view.setUint8(o, tokBytes[t].length);
    o += 1;
    out.set(tokBytes[t], o);
    o += tokBytes[t].length;
    view.setUint32(o, perToken[t].length);
    o += 4;
    for (const p of perToken[t]) {
      view.setUint32(o, p.di);
      o += 4;
      view.setUint32(o, p.pos.length);
      o += 4;
      for (const pos of p.pos) {
        view.setUint32(o, pos);
        o += 4;
      }
    }
  }
  return out;
}

/**
 * Parse the byte layout back into an index. Throws on a bad magic, an unknown version,
 * a doc reference out of range, or any length that runs past the buffer (a truncated or
 * foreign blob) — the reader treats every throw as "can't decrypt/parse".
 */
export function deserializeIndex(bytes: Uint8Array): TrigramIndex {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const need = (n: number) => {
    if (o + n > bytes.length) throw new Error("searchidx: truncated");
  };

  need(MAGIC_BYTES.length + 8);
  for (let i = 0; i < MAGIC_BYTES.length; i++)
    if (bytes[o + i] !== MAGIC_BYTES[i])
      throw new Error("searchidx: bad magic");
  o += MAGIC_BYTES.length;
  const version = view.getUint32(o);
  o += 4;
  if (version !== INDEX_VERSION) throw new Error("searchidx: bad version");
  const docCount = view.getUint32(o);
  o += 4;

  const ids: string[] = [];
  const docMeta = new Map<string, DocMeta>();
  const docTokens = new Map<string, Set<string>>();
  for (let i = 0; i < docCount; i++) {
    need(2);
    const idLen = view.getUint16(o);
    o += 2;
    need(idLen);
    const id = dec.decode(bytes.subarray(o, o + idLen));
    o += idLen;
    need(4);
    const titleLen = view.getUint32(o);
    o += 4;
    ids.push(id);
    docMeta.set(id, { titleLen });
    docTokens.set(id, new Set());
  }

  need(4);
  const tokenCount = view.getUint32(o);
  o += 4;
  const inverted = new Map<string, Map<string, number[]>>();
  for (let t = 0; t < tokenCount; t++) {
    need(1);
    const tokLen = view.getUint8(o);
    o += 1;
    need(tokLen);
    const token = dec.decode(bytes.subarray(o, o + tokLen));
    o += tokLen;
    need(4);
    const postingCount = view.getUint32(o);
    o += 4;
    const byId = new Map<string, number[]>();
    for (let p = 0; p < postingCount; p++) {
      need(8);
      const di = view.getUint32(o);
      o += 4;
      const posCount = view.getUint32(o);
      o += 4;
      if (di >= docCount) throw new Error("searchidx: bad doc ref");
      need(4 * posCount);
      const pos: number[] = new Array(posCount);
      for (let k = 0; k < posCount; k++) {
        pos[k] = view.getUint32(o);
        o += 4;
      }
      const id = ids[di];
      byId.set(id, pos);
      docTokens.get(id)!.add(token);
    }
    inverted.set(token, byId);
  }
  return { version, docMeta, docTokens, inverted };
}
