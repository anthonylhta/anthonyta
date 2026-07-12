/**
 * embedder — the thin, swappable adapter that turns text into a vector. Everything
 * else in the semantic-search pipeline (chunking, quantization, the sealed binary
 * index, top-k search, the vault-sync index build, the `/vault` search island) talks
 * to this one interface, so the embedding model is the ONLY moving part and the rest
 * stays pure and exhaustively testable. The same module runs in the browser and in
 * the Node `vault-sync` bridge — the index and the query MUST come from the identical
 * embedder or their vectors live in different spaces — so it carries no `next`, DOM,
 * or Node-only dependency.
 *
 * MODEL STATUS — the real semantic model is NOT wired yet (see `loadEmbedder`). The
 * flagship intent is an in-browser sentence-embedding model (transformers.js, e.g.
 * `all-MiniLM-L6-v2`, 384-dim) so search matches by MEANING. Wiring it means either
 * bundling ~20 MB+ of weights into a public repo or adding a CDN to `connect-src`
 * (weakening the strict nonce CSP), plus almost certainly `'wasm-unsafe-eval'` in
 * `script-src` for the ONNX WASM backend — all of which a green CI can't carry today.
 * So the pipeline ships LIVE behind a dependency-free LEXICAL placeholder (feature
 * hashing over word + character-trigram tokens): real, deterministic vectors that
 * exercise the whole path end-to-end, but lexical, not semantic. Swapping in the
 * model is a one-body change here (same `Embedder` interface) followed by a one-off
 * re-run of `vault-sync` to rebuild the index at the new dimension.
 */

/** The placeholder embedding dimension. Small keeps the sealed index compact; a real
 *  model (MiniLM = 384) will differ, and a dimension change forces a full re-index —
 *  the build and the reader both key compatibility off `dim`. */
export const EMBED_DIM = 256;

/**
 * The one interface the rest of the pipeline depends on. `dim` is fixed for a given
 * embedder; `embed` is async because a real model's inference is (WASM/WebGPU), even
 * though the placeholder resolves synchronously. `kind` names the vector space, for
 * logging + a future "the model changed, re-index" signal.
 */
export interface Embedder {
  readonly dim: number;
  readonly kind: string;
  embed(text: string): Promise<Float32Array>;
}

// --- the lexical placeholder (dependency-free, deterministic, browser === Node) ---

/** FNV-1a 32-bit — a fast, stable string hash. `Math.imul` keeps it in 32-bit range
 *  identically across engines, so the browser and Node hash a token to the same slot. */
function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Signed feature hashing: fold one feature into the vector at `hash % dim`, with a
 *  sign from a second hash so collisions partly cancel instead of always piling up. */
function addFeature(vec: Float32Array, feature: string, dim: number): void {
  const slot = fnv1a(feature) % dim;
  const sign = (fnv1a(feature, 0x9e3779b1) & 1) === 0 ? 1 : -1;
  vec[slot] += sign;
}

/** L2-normalize in place; a zero vector (empty text) stays zero — never NaN. */
function unit(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/**
 * A deterministic LEXICAL embedder: lowercase word tokens plus their character
 * trigrams, hashed into a fixed-dim unit vector. Cosine then measures shared
 * vocabulary — a real signal for the pipeline to rank on, and a clean stand-in for a
 * semantic model behind the same interface. Not semantic: this is the documented
 * placeholder, swapped out in `loadEmbedder`.
 */
export function lexicalEmbedder(dim: number = EMBED_DIM): Embedder {
  return {
    dim,
    kind: "lexical-hash-v1",
    embed(text: string): Promise<Float32Array> {
      const vec = new Float32Array(dim);
      for (const tok of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        addFeature(vec, tok, dim);
        const padded = `#${tok}#`; // boundary markers so prefixes/suffixes count
        for (let i = 0; i + 3 <= padded.length; i++)
          addFeature(vec, padded.slice(i, i + 3), dim);
      }
      return Promise.resolve(unit(vec));
    },
  };
}

// --- the loader the app calls (memoized: one warm embedder per session) -----------

let embedderPromise: Promise<Embedder> | null = null;

/**
 * The warm embedder for this session, loaded once and cached. Callers `await` it on
 * first search; a real model's weights would download here (seconds, once).
 */
export function getEmbedder(): Promise<Embedder> {
  return (embedderPromise ??= loadEmbedder());
}

/**
 * WIRING THE REAL MODEL — the one piece left. Replace the body below with a lazy load
 * of an in-browser sentence-embedding model and return it behind this same interface:
 *
 *   1. Add `@huggingface/transformers` (or `@xenova/transformers`) and SELF-HOST the
 *      model weights same-origin (serve from `/public` or a route) so `connect-src`
 *      stays `'self'` — do NOT point it at a CDN, that reopens the CSP.
 *   2. `const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2",
 *      { quantized: true })`; `embed = async (t) => new Float32Array((await pipe(t,
 *      { pooling: "mean", normalize: true })).data)`; `dim = 384`, `kind = "minilm-…"`.
 *   3. CSP: the ONNX WASM backend needs `'wasm-unsafe-eval'` in `script-src` — add it
 *      to `lib/csp.ts` (+ its unit test + the e2e header lock) TOGETHER, or run the
 *      WebGPU backend where the device allows and gate the WASM fallback behind that
 *      one directive. Keep `wasm-unsafe-eval` OUT of the policy until this ships.
 *   4. Re-run `npm run vault-sync` once to rebuild `vault/search-index.bin` at the new
 *      dimension; the reader re-fetches it and the stale-dim guard clears itself.
 *
 * Until then: the lexical placeholder keeps the whole pipeline live and testable.
 */
function loadEmbedder(): Promise<Embedder> {
  return Promise.resolve(lexicalEmbedder());
}
