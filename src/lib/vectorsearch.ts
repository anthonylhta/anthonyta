/**
 * Private semantic search over the vault — search the journal by MEANING, with the
 * embedding model running in the browser and the vector index stored as just more
 * ciphertext. The server learns neither what was written nor what was searched: the
 * index (note/chunk vectors) is sealed under the master key like every other vault
 * blob, decrypted in the browser, and the query is embedded and matched entirely
 * client-side. This module is the pure spine of that — the vector math, the compact
 * quantized index format that keeps the sealed blob small, and the top-k search. The
 * embedding model and the AEV1 sealing live outside it, so this stays dependency-free
 * and exhaustively testable.
 */

// --- vector math --------------------------------------------------------------

/** L2-normalize a vector (a zero vector stays zero — no NaN). */
export function normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(vec.length);
  if (norm === 0) return out;
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** Dot product (the two vectors must share a dimension). */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length)
    throw new Error("vectorsearch: dimension mismatch");
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += a[i] * b[i];
  return acc;
}

/** Cosine similarity in [-1, 1] (0 when either vector is zero). */
export function cosine(a: Float32Array, b: Float32Array): number {
  const na = normalize(a);
  const nb = normalize(b);
  return dot(na, nb);
}

// --- int8 quantization (keeps the sealed index ~4× smaller than float32) ------

/**
 * Symmetric int8 quantization of a vector: `scale = maxAbs / 127`, values rounded and
 * clamped to [-127, 127]. Returns the codes + the scale to restore them. A zero
 * vector quantizes to all-zero with scale 1 (no div-by-zero).
 */
export function quantize(vec: Float32Array): { q: Int8Array; scale: number } {
  let maxAbs = 0;
  for (const x of vec) maxAbs = Math.max(maxAbs, Math.abs(x));
  const scale = maxAbs === 0 ? 1 : maxAbs / 127;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    q[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / scale)));
  }
  return { q, scale };
}

/** Restore an approximate float vector from its int8 codes and scale. */
export function dequantize(q: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * scale;
  return out;
}

// --- the index (plaintext shape, sealed elsewhere) ----------------------------

/** One searchable unit: an id (`<noteId>#<chunk>`), its quantized vector, and an
 *  optional preview shown in results. */
export interface IndexEntry {
  id: string;
  q: Int8Array;
  scale: number;
  preview?: string;
}

/** The decrypted search index — every chunk's vector at a fixed dimension. */
export interface SearchIndex {
  dim: number;
  entries: IndexEntry[];
}

export interface SearchResult {
  id: string;
  score: number;
  preview?: string;
}

/**
 * The top-`k` entries by cosine similarity to `query`. Dequantizes each stored vector
 * and scores it; ties break by insertion order. `k <= 0` or an empty index → []. The
 * query dimension must match the index.
 */
export function search(
  query: Float32Array,
  index: SearchIndex,
  k: number,
): SearchResult[] {
  if (k <= 0 || index.entries.length === 0) return [];
  if (query.length !== index.dim)
    throw new Error("vectorsearch: query dimension mismatch");
  const nq = normalize(query);
  const scored = index.entries.map((e) => ({
    id: e.id,
    preview: e.preview,
    score: dot(nq, normalize(dequantize(e.q, e.scale))),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// --- binary serialization (the bytes that get sealed) -------------------------
//
// [ "VS01" | dim:u16 | count:u32 ]  then per entry:
// [ idLen:u16 | id:utf8 | previewLen:u16 | preview:utf8 | scale:f32 | q:dim×i8 ]
// Big-endian, so the format is stable across machines.

const MAGIC = "VS01";
const MAGIC_BYTES = new TextEncoder().encode(MAGIC);

/** Serialize an index to the compact byte layout that gets AEV1-sealed. */
export function serializeIndex(index: SearchIndex): Uint8Array {
  const enc = new TextEncoder();
  const parts: { id: Uint8Array; preview: Uint8Array; entry: IndexEntry }[] =
    index.entries.map((entry) => ({
      id: enc.encode(entry.id),
      preview: enc.encode(entry.preview ?? ""),
      entry,
    }));

  let size = MAGIC_BYTES.length + 2 + 4;
  for (const p of parts)
    size += 2 + p.id.length + 2 + p.preview.length + 4 + index.dim;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  out.set(MAGIC_BYTES, o);
  o += MAGIC_BYTES.length;
  view.setUint16(o, index.dim);
  o += 2;
  view.setUint32(o, index.entries.length);
  o += 4;
  for (const p of parts) {
    view.setUint16(o, p.id.length);
    o += 2;
    out.set(p.id, o);
    o += p.id.length;
    view.setUint16(o, p.preview.length);
    o += 2;
    out.set(p.preview, o);
    o += p.preview.length;
    view.setFloat32(o, p.entry.scale);
    o += 4;
    out.set(
      new Uint8Array(p.entry.q.buffer, p.entry.q.byteOffset, index.dim),
      o,
    );
    o += index.dim;
  }
  return out;
}

/** Parse the byte layout back into an index. Throws on a bad magic or a length that
 *  runs past the buffer (a truncated or foreign blob). */
export function parseIndex(bytes: Uint8Array): SearchIndex {
  const dec = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  // Guard EVERY read up front, so a truncated or foreign blob fails cleanly here
  // rather than as a native DataView range error.
  const need = (n: number) => {
    if (o + n > bytes.length) throw new Error("vectorsearch: truncated");
  };

  need(MAGIC_BYTES.length + 6);
  for (let i = 0; i < MAGIC_BYTES.length; i++)
    if (bytes[o + i] !== MAGIC_BYTES[i])
      throw new Error("vectorsearch: bad magic");
  o += MAGIC_BYTES.length;
  const dim = view.getUint16(o);
  o += 2;
  const count = view.getUint32(o);
  o += 4;

  const entries: IndexEntry[] = [];
  for (let i = 0; i < count; i++) {
    need(2);
    const idLen = view.getUint16(o);
    o += 2;
    need(idLen);
    const id = dec.decode(bytes.subarray(o, o + idLen));
    o += idLen;
    need(2);
    const previewLen = view.getUint16(o);
    o += 2;
    need(previewLen);
    const preview = dec.decode(bytes.subarray(o, o + previewLen));
    o += previewLen;
    need(4 + dim);
    const scale = view.getFloat32(o);
    o += 4;
    const q = new Int8Array(bytes.slice(o, o + dim).buffer);
    o += dim;
    entries.push(preview ? { id, q, scale, preview } : { id, q, scale });
  }
  return { dim, entries };
}

// --- chunking (index-build side; pure so it's tested here) --------------------

/**
 * Split note text into overlapping word chunks for embedding — one vector per chunk,
 * so search lands on a passage, not a whole note. `size` words per chunk, `overlap`
 * words shared with the next so a match near a boundary isn't lost. Whitespace-
 * collapsed; short text yields a single chunk.
 */
export function chunkText(text: string, size = 120, overlap = 30): string[] {
  if (overlap >= size) throw new Error("vectorsearch: overlap must be < size");
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  if (words.length <= size) return [words.join(" ")];
  const step = size - overlap;
  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += step) {
    chunks.push(words.slice(start, start + size).join(" "));
    if (start + size >= words.length) break;
  }
  return chunks;
}
