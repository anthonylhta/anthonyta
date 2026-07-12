/**
 * Shamir's Secret Sharing over GF(2^8) — split a secret into `n` shares of which
 * any `k` reconstruct it, while any `k-1` reveal NOTHING (information-theoretic, not
 * just computationally hard). The hub uses it for paper recovery: the 32-byte master
 * key is split into printed QR shares stashed in separate places, so forgetting the
 * passphrase stops being total loss without ever putting the key on a server — the
 * split and the reconstruction both happen in the browser, and the shares never touch
 * the network.
 *
 * The field is GF(2^8) with the AES reduction polynomial (0x11b), so every byte of
 * the secret is shared independently as the constant term of a random degree-(k-1)
 * polynomial; a share is that polynomial family evaluated at a distinct x in 1..255.
 * Reconstruction is Lagrange interpolation back to x = 0. Pure, dependency-free, and
 * exhaustively testable — the whole point of doing it from the paper.
 *
 * SSS carries no integrity of its own (combining wrong shares yields a wrong secret
 * silently); the share wire format adds a version + checksum so a damaged or mistyped
 * share is caught up front, and the recovery flow's real integrity check is that the
 * reconstructed key actually unwraps the keystore.
 */

// --- GF(2^8) arithmetic via log/exp tables (generator 3, poly 0x11b) ----------

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply x by the generator 3 (= x+1) with 0x11b reduction
    const hi = x & 0x80;
    x = (x << 1) & 0xff;
    if (hi) x ^= 0x1b;
    x ^= EXP[i]; // times 3 = times 2 XOR times 1
  }
  EXP[255] = EXP[0]; // exp wraps with period 255
})();

/** GF(2^8) multiply. */
function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

/** GF(2^8) multiplicative inverse (a ≠ 0). */
function inv(a: number): number {
  return EXP[(255 - LOG[a]) % 255];
}

/** Evaluate the polynomial with `coeffs` (constant term first) at `x`, in GF(2^8). */
function evalPoly(coeffs: Uint8Array, x: number): number {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) acc = mul(acc, x) ^ coeffs[i];
  return acc;
}

// --- split / combine ----------------------------------------------------------

/** One share: an x-coordinate (1..255) and one y-byte per secret byte. */
export interface Share {
  x: number;
  y: Uint8Array;
}

/**
 * Split `secret` into `n` shares, any `threshold` of which reconstruct it. Throws on
 * out-of-range parameters. Coefficients come from the CSPRNG, so the sharing is fresh
 * every call; x-coordinates are 1..n (0 is the secret itself and is never a share).
 */
export function split(
  secret: Uint8Array,
  n: number,
  threshold: number,
): Share[] {
  if (!Number.isInteger(n) || !Number.isInteger(threshold))
    throw new Error("shamir: n and threshold must be integers");
  if (threshold < 2) throw new Error("shamir: threshold must be at least 2");
  if (n < threshold) throw new Error("shamir: n must be >= threshold");
  if (n > 255) throw new Error("shamir: n must be at most 255");
  if (secret.length === 0) throw new Error("shamir: secret must be non-empty");

  const shares: Share[] = [];
  for (let x = 1; x <= n; x++)
    shares.push({ x, y: new Uint8Array(secret.length) });

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // coeffs[0] = the secret byte; the rest are random (the polynomial's slope).
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[byteIdx];
    crypto.getRandomValues(coeffs.subarray(1));
    for (const share of shares) share.y[byteIdx] = evalPoly(coeffs, share.x);
  }
  return shares;
}

/**
 * Reconstruct the secret from `shares` via Lagrange interpolation at x = 0. Needs at
 * least `threshold`-many CORRECT shares with distinct x; fewer (or wrong) shares yield
 * a wrong secret with no error, which is why the recovery flow verifies the result by
 * unwrapping the keystore. Throws only on structurally invalid input (duplicate or
 * out-of-range x, mismatched lengths, empty set).
 */
export function combine(shares: Share[]): Uint8Array {
  if (shares.length === 0) throw new Error("shamir: no shares");
  const len = shares[0].y.length;
  const xs = new Set<number>();
  for (const s of shares) {
    if (s.x < 1 || s.x > 255) throw new Error("shamir: share x out of range");
    if (s.y.length !== len) throw new Error("shamir: share length mismatch");
    if (xs.has(s.x)) throw new Error("shamir: duplicate share x");
    xs.add(s.x);
  }

  // Lagrange basis at x=0: for share j, ∏_{m≠j} x_m / (x_m − x_j). In GF(2^8)
  // subtraction is XOR, division is multiply-by-inverse.
  const basis = shares.map((sj, j) => {
    let acc = 1;
    for (let m = 0; m < shares.length; m++) {
      if (m === j) continue;
      const xm = shares[m].x;
      acc = mul(acc, mul(xm, inv(xm ^ sj.x)));
    }
    return acc;
  });

  const secret = new Uint8Array(len);
  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    let value = 0;
    for (let j = 0; j < shares.length; j++)
      value ^= mul(shares[j].y[byteIdx], basis[j]);
    secret[byteIdx] = value;
  }
  return secret;
}

// --- wire format (what a QR encodes) ------------------------------------------
//
// A share serializes to base64url of: [version=1][threshold][x][...y][checksum],
// where checksum = the low byte of the sum of every preceding byte — enough to catch
// a damaged scan or a mistyped character before reconstruction is attempted.

const SHARE_VERSION = 1;

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return sum;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Serialize a share (plus its threshold, for the UI) to a compact QR payload. */
export function formatShare(share: Share, threshold: number): string {
  const head = new Uint8Array(3 + share.y.length);
  head[0] = SHARE_VERSION;
  head[1] = threshold;
  head[2] = share.x;
  head.set(share.y, 3);
  const out = new Uint8Array(head.length + 1);
  out.set(head, 0);
  out[head.length] = checksum(head);
  return b64url(out);
}

export interface ParsedShare {
  share: Share;
  threshold: number;
}

/**
 * Parse + verify a QR payload back into a share. Returns null on a bad version, a
 * failed checksum (damaged/mistyped), or a structurally impossible length — so the UI
 * can reject a bad scan before it poisons a reconstruction.
 */
export function parseShare(payload: string): ParsedShare | null {
  let bytes: Uint8Array;
  try {
    bytes = fromB64url(payload.trim());
  } catch {
    return null;
  }
  if (bytes.length < 5) return null; // version+threshold+x+≥1 y-byte+checksum
  const body = bytes.subarray(0, bytes.length - 1);
  if (bytes[bytes.length - 1] !== checksum(body)) return null;
  if (body[0] !== SHARE_VERSION) return null;
  const threshold = body[1];
  const x = body[2];
  if (x < 1 || x > 255 || threshold < 2) return null;
  return { share: { x, y: body.subarray(3).slice() }, threshold };
}
