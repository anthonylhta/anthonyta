/**
 * exif — a pure, byte-level metadata stripper + inspector for the E2EE files inbox
 * (security backlog PR 08). No imports, no Node-only APIs: the same module runs in the
 * window and in Node-vitest, and it never touches the network.
 *
 * WHY this exists: E2EE already hides a photo's pixels from the server, but a fragment-key
 * share link decrypts those pixels on a RECIPIENT's device — and a camera photo carries GPS
 * coordinates, the device make/model, and capture timestamps inside its metadata. The threat
 * here is the recipient, not the server. `strip` removes that metadata in the browser before
 * anything is sealed; `inspect` reports what was there so the UI can be honest instead of magic.
 *
 * HOW it works — structural, never a canvas re-encode. Re-encoding kills metadata but
 * recompresses (quality loss, bigger files, orientation bugs). Instead this walks each
 * container as the segment/chunk stream it is and drops the NAMED metadata containers,
 * leaving the compressed image data byte-identical:
 *   - JPEG  — a marker/segment stream: drop APP1-Exif, APP1-XMP, APP13-IPTC, COM; KEEP APP2-ICC.
 *   - PNG   — a chunk stream: drop `eXIf`, `tEXt`, `iTXt`, `zTXt`.
 *   - WebP  — a RIFF chunk stream: drop `EXIF`, `XMP `, and clear the VP8X presence flags.
 *
 * WHAT STAYS, and the one lossy edge:
 *   - ICC color profiles (JPEG APP2, PNG `iCCP`) survive — stripping them visibly shifts colors
 *     and identifies nobody.
 *   - EXIF ORIENTATION is the single lossy edge: dropping a JPEG's APP1-Exif would lose the
 *     rotation flag and turn portrait photos sideways. So the JPEG stripper reads the original
 *     Orientation and, when it's a real rotation (2..8), rewrites a MINIMAL 1-tag EXIF block
 *     carrying only Orientation — nothing else. That is a deliberate, documented tradeoff: a
 *     few bytes of the least-identifying tag are re-emitted so the image still displays upright.
 *     (PNG/WebP have no equivalent rewrite — their orientation is rarely honored, and the spec
 *     scopes the rewrite to JPEG.)
 *
 * KNOWN GAP — HEIC/AVIF (ISO-BMFF `ftyp` containers) are NOT understood and pass through
 * UNTOUCHED, metadata intact. Their metadata lives in nested `meta`/`iinf`/`iloc` boxes that
 * need a full box parser; stripping them safely is a separate job. `sniff` returns "unknown"
 * for them so a caller can say so honestly rather than claim a strip it didn't do. Anything not
 * recognized as JPEG/PNG/WebP is likewise passed through unchanged — this module never corrupts
 * what it doesn't understand.
 *
 * `strip` is idempotent: strip(strip(x)) === strip(x).
 */

/** A recognized container, or "unknown" for everything this module passes through. */
export type Format = "jpeg" | "png" | "webp" | "unknown";

/**
 * What `inspect` found — booleans powering an honest UI ("gps + device present" vs "no
 * identifying metadata"). `comments` folds every freeform-text container: JPEG COM markers,
 * XMP, IPTC, and EXIF ImageDescription/UserComment.
 */
export interface MetaFindings {
  gps: boolean;
  make: boolean;
  model: boolean;
  dates: boolean;
  comments: boolean;
}

function emptyFindings(): MetaFindings {
  return {
    gps: false,
    make: false,
    model: false,
    dates: false,
    comments: false,
  };
}

// ---------------------------------------------------------------------------
// format sniffing
// ---------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True iff `bytes` matches `pattern` (a byte list) starting at `at`. */
function matches(
  bytes: Uint8Array,
  at: number,
  pattern: readonly number[],
): boolean {
  if (at + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[at + i] !== pattern[i]) return false;
  }
  return true;
}

/** ASCII → byte list, for the four-char container tags/prefixes compared below. */
function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

const EXIF_PREFIX = ascii("Exif\0\0"); // JPEG APP1 EXIF / (some) WebP EXIF payload prefix
const XMP_PREFIX = ascii("http://ns.adobe.com/x"); // covers xap/1.0 + xmp/extension

/**
 * Classify by magic bytes only — cheap and allocation-free. HEIC/AVIF (`ftyp` at offset 4)
 * deliberately reads as "unknown": recognized but unsupported, so the caller can say so.
 */
export function sniff(bytes: Uint8Array): Format {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "jpeg";
  if (matches(bytes, 0, PNG_SIG)) return "png";
  if (
    bytes.length >= 12 &&
    matches(bytes, 0, ascii("RIFF")) &&
    matches(bytes, 8, ascii("WEBP"))
  )
    return "webp";
  return "unknown";
}

// ---------------------------------------------------------------------------
// TIFF / EXIF IFD reader (shared by JPEG APP1-Exif, PNG eXIf, WebP EXIF)
// ---------------------------------------------------------------------------

interface TiffInfo {
  orientation?: number;
  make: boolean;
  model: boolean;
  dates: boolean;
  gps: boolean;
  /** ImageDescription / UserComment — folds into the caller's `comments`. */
  description: boolean;
}

function u16(t: Uint8Array, off: number, le: boolean): number {
  if (off < 0 || off + 2 > t.length) return 0;
  return le ? t[off] | (t[off + 1] << 8) : (t[off] << 8) | t[off + 1];
}

function u32(t: Uint8Array, off: number, le: boolean): number {
  if (off < 0 || off + 4 > t.length) return 0;
  return le
    ? (t[off] | (t[off + 1] << 8) | (t[off + 2] << 16) | (t[off + 3] << 24)) >>>
        0
    : ((t[off] << 24) | (t[off + 1] << 16) | (t[off + 2] << 8) | t[off + 3]) >>>
        0;
}

// EXIF tag numbers used below (IFD0 + Exif sub-IFD).
const TAG_IMAGE_DESCRIPTION = 0x010e;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_USER_COMMENT = 0x9286;

/**
 * Walk one IFD, recording tags of interest into `info`. Bounds-checked at every read and
 * depth-limited, so a truncated or self-referential IFD stops quietly rather than throwing or
 * looping. A GPS sub-IFD counts as "gps present" the moment it holds any entry.
 */
function readIfd(
  t: Uint8Array,
  off: number,
  le: boolean,
  info: TiffInfo,
  isGps: boolean,
  depth: number,
): void {
  if (depth > 4 || off < 2 || off + 2 > t.length) return;
  const count = u16(t, off, le);
  if (isGps) {
    if (count > 0) info.gps = true;
    return;
  }
  let entry = off + 2;
  for (let i = 0; i < count; i++) {
    if (entry + 12 > t.length) return;
    const tag = u16(t, entry, le);
    const valOff = entry + 8;
    switch (tag) {
      case TAG_IMAGE_DESCRIPTION:
      case TAG_USER_COMMENT:
        info.description = true;
        break;
      case TAG_MAKE:
        info.make = true;
        break;
      case TAG_MODEL:
        info.model = true;
        break;
      case TAG_DATETIME:
      case TAG_DATETIME_ORIGINAL:
      case TAG_DATETIME_DIGITIZED:
        info.dates = true;
        break;
      case TAG_ORIENTATION:
        info.orientation = u16(t, valOff, le);
        break;
      case TAG_EXIF_IFD:
        readIfd(t, u32(t, valOff, le), le, info, false, depth + 1);
        break;
      case TAG_GPS_IFD:
        readIfd(t, u32(t, valOff, le), le, info, true, depth + 1);
        break;
    }
    entry += 12;
  }
}

/** Parse a TIFF stream (EXIF payload with the "Exif\0\0" prefix already removed). */
function parseTiff(t: Uint8Array): TiffInfo {
  const info: TiffInfo = {
    make: false,
    model: false,
    dates: false,
    gps: false,
    description: false,
  };
  if (t.length < 8) return info;
  let le: boolean;
  if (t[0] === 0x49 && t[1] === 0x49)
    le = true; // "II" — little-endian
  else if (t[0] === 0x4d && t[1] === 0x4d)
    le = false; // "MM" — big-endian
  else return info;
  if (u16(t, 2, le) !== 42) return info;
  readIfd(t, u32(t, 4, le), le, info, false, 0);
  return info;
}

/** Fold a parsed TIFF's findings into the running `MetaFindings`. */
function foldTiff(t: Uint8Array, f: MetaFindings): TiffInfo {
  const info = parseTiff(t);
  if (info.make) f.make = true;
  if (info.model) f.model = true;
  if (info.dates) f.dates = true;
  if (info.gps) f.gps = true;
  if (info.description) f.comments = true;
  return info;
}

// ---------------------------------------------------------------------------
// the plan — a per-format walk that yields findings + the ranges to keep
// ---------------------------------------------------------------------------

/**
 * `ok` false means malformed/truncated: `strip` passes the input through untouched. `findings`
 * is populated best-effort regardless, so `inspect` still reports whatever was read first.
 */
interface Plan {
  ok: boolean;
  findings: MetaFindings;
  parts: Uint8Array[] | null;
}

/** The minimal APP1-Exif segment carrying ONLY Orientation — the JPEG rotation rewrite. */
function orientationApp1(orientation: number): Uint8Array {
  // FFE1 + len(34) + "Exif\0\0" + TIFF{ MM, 42, ifd0@8, count=1, [Orientation SHORT], next=0 }
  const seg = new Uint8Array(36);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg[2] = 0x00;
  seg[3] = 0x22; // segment length = 34 (2 length bytes + 32 payload)
  seg[4] = 0x45; // 'E'
  seg[5] = 0x78; // 'x'
  seg[6] = 0x69; // 'i'
  seg[7] = 0x66; // 'f'
  seg[8] = 0x00;
  seg[9] = 0x00;
  seg[10] = 0x4d; // 'M' — big-endian TIFF
  seg[11] = 0x4d; // 'M'
  seg[12] = 0x00;
  seg[13] = 0x2a; // magic 42
  seg[14] = 0x00;
  seg[15] = 0x00;
  seg[16] = 0x00;
  seg[17] = 0x08; // IFD0 offset = 8
  seg[18] = 0x00;
  seg[19] = 0x01; // one entry
  seg[20] = 0x01;
  seg[21] = 0x12; // tag 0x0112 Orientation
  seg[22] = 0x00;
  seg[23] = 0x03; // type SHORT
  seg[24] = 0x00;
  seg[25] = 0x00;
  seg[26] = 0x00;
  seg[27] = 0x01; // count 1
  seg[28] = (orientation >> 8) & 0xff; // value (SHORT, left-justified in the 4-byte field)
  seg[29] = orientation & 0xff;
  seg[30] = 0x00;
  seg[31] = 0x00;
  seg[32] = 0x00;
  seg[33] = 0x00;
  seg[34] = 0x00;
  seg[35] = 0x00; // next IFD offset = 0
  return seg;
}

/** JPEG: a marker/segment walk. Drops EXIF/XMP/IPTC/COM, keeps ICC + image data, rewrites orientation. */
function planJpeg(bytes: Uint8Array): Plan {
  const findings = emptyFindings();
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return { ok: false, findings, parts: null };

  const kept: Uint8Array[] = [];
  let orientation: number | undefined;
  let tail: Uint8Array | null = null;
  let pos = 2;

  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) return { ok: false, findings, parts: null };
    // Skip a run of fill 0xFF bytes; the byte after them is the marker code.
    let m = pos;
    while (m < bytes.length && bytes[m] === 0xff) m++;
    if (m >= bytes.length) return { ok: false, findings, parts: null };
    const marker = bytes[m];
    const markerStart = pos; // include any leading fill bytes in the kept range
    const afterMarker = m + 1;

    // Start-of-scan: the entropy-coded image data runs to EOF — copy it verbatim.
    if (marker === 0xda) {
      tail = bytes.subarray(markerStart);
      break;
    }
    // Standalone markers carry no length payload.
    if (marker === 0xd9) {
      // EOI (no scan) — copy the remainder verbatim and stop.
      tail = bytes.subarray(markerStart);
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // TEM / RSTn before a scan is abnormal but harmless — keep the two bytes.
      kept.push(bytes.subarray(markerStart, afterMarker));
      pos = afterMarker;
      continue;
    }

    // Length-bearing segment: 2-byte big-endian length (includes itself) + payload.
    if (afterMarker + 2 > bytes.length)
      return { ok: false, findings, parts: null };
    const length = (bytes[afterMarker] << 8) | bytes[afterMarker + 1];
    if (length < 2) return { ok: false, findings, parts: null };
    const payloadStart = afterMarker + 2;
    const segEnd = afterMarker + length;
    if (segEnd > bytes.length) return { ok: false, findings, parts: null };
    const seg = bytes.subarray(markerStart, segEnd);

    if (marker === 0xe1) {
      // APP1: EXIF or XMP get dropped; any other APP1 is kept.
      if (matches(bytes, payloadStart, EXIF_PREFIX)) {
        const info = foldTiff(
          bytes.subarray(payloadStart + 6, segEnd),
          findings,
        );
        if (info.orientation !== undefined) orientation = info.orientation;
      } else if (matches(bytes, payloadStart, XMP_PREFIX)) {
        findings.comments = true;
      } else {
        kept.push(seg);
      }
    } else if (marker === 0xed) {
      // APP13: Photoshop IRB / IPTC — drop.
      findings.comments = true;
    } else if (marker === 0xfe) {
      // COM: free-text comment — drop.
      findings.comments = true;
    } else {
      // APP0 (JFIF), APP2 (ICC), APP14 (Adobe), DQT/DHT/SOFn, DRI, … — keep.
      kept.push(seg);
    }
    pos = segEnd;
  }

  // A header with no scan/EOI is truncated — pass through untouched.
  if (!tail) return { ok: false, findings, parts: null };

  const parts: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  if (orientation !== undefined && orientation >= 2 && orientation <= 8)
    parts.push(orientationApp1(orientation));
  for (const s of kept) parts.push(s);
  parts.push(tail);
  return { ok: true, findings, parts };
}

const PNG_EXIF = ascii("eXIf");
const PNG_TEXT = ascii("tEXt");
const PNG_ITXT = ascii("iTXt");
const PNG_ZTXT = ascii("zTXt");
const PNG_IEND = ascii("IEND");

/** PNG: a chunk walk. Drops `eXIf` + the text chunks; every other chunk (incl. `iCCP`) is kept verbatim. */
function planPng(bytes: Uint8Array): Plan {
  const findings = emptyFindings();
  if (bytes.length < 8 || !matches(bytes, 0, PNG_SIG))
    return { ok: false, findings, parts: null };

  const parts: Uint8Array[] = [bytes.subarray(0, 8)]; // signature
  let pos = 8;

  while (pos < bytes.length) {
    if (pos + 8 > bytes.length) return { ok: false, findings, parts: null };
    const len = u32(bytes, pos, false);
    const typeAt = pos + 4;
    const dataStart = pos + 8;
    const chunkEnd = dataStart + len + 4; // data + 4-byte CRC
    if (chunkEnd > bytes.length) return { ok: false, findings, parts: null };

    const isExif = matches(bytes, typeAt, PNG_EXIF);
    const isText =
      matches(bytes, typeAt, PNG_TEXT) ||
      matches(bytes, typeAt, PNG_ITXT) ||
      matches(bytes, typeAt, PNG_ZTXT);

    if (isExif) {
      // eXIf data IS a raw TIFF stream (no "Exif\0\0" prefix) — drop, but read findings.
      foldTiff(bytes.subarray(dataStart, dataStart + len), findings);
    } else if (isText) {
      findings.comments = true;
    } else {
      parts.push(bytes.subarray(pos, chunkEnd));
    }

    pos = chunkEnd;
    if (matches(bytes, typeAt, PNG_IEND)) break; // nothing follows IEND
  }

  return { ok: true, findings, parts };
}

const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const WEBP_EXIF = ascii("EXIF");
const WEBP_XMP = ascii("XMP ");
const WEBP_VP8X = ascii("VP8X");

/** WebP: a RIFF chunk walk. Drops `EXIF` + `XMP `, clears the VP8X presence flags, fixes RIFF size. */
function planWebp(bytes: Uint8Array): Plan {
  const findings = emptyFindings();
  if (bytes.length < 12 || !matches(bytes, 0, RIFF) || !matches(bytes, 8, WEBP))
    return { ok: false, findings, parts: null };

  const body: Uint8Array[] = [];
  let pos = 12;

  while (pos + 8 <= bytes.length) {
    const at = pos + 4;
    const size = u32(bytes, at, true); // little-endian chunk size
    const dataStart = pos + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) return { ok: false, findings, parts: null };
    const pad = size & 1; // RIFF chunks pad to even length
    // Tolerate a missing final pad byte at EOF rather than rejecting an otherwise-clean file.
    const chunkEnd = Math.min(dataEnd + pad, bytes.length);

    if (matches(bytes, pos, WEBP_EXIF)) {
      foldWebpExif(bytes.subarray(dataStart, dataEnd), findings);
    } else if (matches(bytes, pos, WEBP_XMP)) {
      findings.comments = true;
    } else if (matches(bytes, pos, WEBP_VP8X)) {
      // Keep VP8X, but clear its EXIF (0x08) + XMP (0x04) presence flags so the
      // container doesn't advertise chunks we just removed.
      const chunk = bytes.slice(pos, chunkEnd);
      if (chunk.length > 8) chunk[8] &= ~0x0c;
      body.push(chunk);
    } else {
      body.push(bytes.subarray(pos, chunkEnd));
    }

    pos = chunkEnd;
  }
  if (pos !== bytes.length) return { ok: false, findings, parts: null };

  let bodyLen = 0;
  for (const c of body) bodyLen += c.length;
  const header = new Uint8Array(12);
  header.set(RIFF, 0);
  const riffSize = 4 + bodyLen; // "WEBP" + chunk bytes
  header[4] = riffSize & 0xff;
  header[5] = (riffSize >>> 8) & 0xff;
  header[6] = (riffSize >>> 16) & 0xff;
  header[7] = (riffSize >>> 24) & 0xff;
  header.set(WEBP, 8);

  return { ok: true, findings, parts: [header, ...body] };
}

/** WebP EXIF chunk data → findings. Some encoders wrongly prefix "Exif\0\0"; tolerate both. */
function foldWebpExif(data: Uint8Array, f: MetaFindings): void {
  const tiff = matches(data, 0, EXIF_PREFIX) ? data.subarray(6) : data;
  foldTiff(tiff, f);
}

function planFor(bytes: Uint8Array): Plan | null {
  switch (sniff(bytes)) {
    case "jpeg":
      return planJpeg(bytes);
    case "png":
      return planPng(bytes);
    case "webp":
      return planWebp(bytes);
    default:
      return null;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Report the identifying metadata present in `bytes` — booleans for an honest UI. An unknown
 * format (incl. HEIC/AVIF) or an empty buffer reports nothing found, which is truthful: this
 * module can't see inside those containers, so it makes no claim about them.
 */
export function inspect(bytes: Uint8Array): MetaFindings {
  const plan = planFor(bytes);
  return plan ? plan.findings : emptyFindings();
}

/**
 * Return `bytes` with identifying metadata removed, image data byte-identical. Unknown or
 * malformed input is returned UNCHANGED (the same reference) — this never corrupts what it
 * can't fully parse. Idempotent: strip(strip(x)) === strip(x).
 */
export function strip(bytes: Uint8Array): Uint8Array {
  const plan = planFor(bytes);
  if (!plan || !plan.ok || !plan.parts) return bytes;
  return concat(plan.parts);
}
