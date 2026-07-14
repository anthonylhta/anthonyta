import { describe, expect, it } from "vitest";
import { inspect, sniff, strip, type MetaFindings } from "./exif";

// ---------------------------------------------------------------------------
// fixture builders — synthesize real segment/chunk streams with known metadata.
// A real-camera JPEG can't ride in CI, so we forge the containers by hand: the
// point is that the walkers see genuine EXIF/GPS payloads, not that the pixels
// decode.
// ---------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function asciiBytes(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

/** A 4-byte inline TIFF value field for a short ASCII value, zero-padded. */
function asciiVal(s: string): number[] {
  const b = asciiBytes(s);
  return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
}

function w16(le: boolean, v: number): number[] {
  return le ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff];
}

function w32(le: boolean, v: number): number[] {
  const b = [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  return le ? b : b.reverse();
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function indexOfSub(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

interface TiffOpts {
  le?: boolean;
  make?: boolean;
  model?: boolean;
  orientation?: number;
  dates?: boolean;
  gps?: boolean;
  description?: boolean;
  exifSub?: boolean;
}

/** Build a TIFF/EXIF stream (the payload after any "Exif\0\0" prefix). */
function buildExifTiff(opts: TiffOpts = {}): Uint8Array {
  const {
    le = false,
    make = true,
    model = true,
    orientation,
    dates = true,
    gps = true,
    description = false,
    exifSub = false,
  } = opts;

  const defs: {
    tag: number;
    type: number;
    count: number;
    val: () => number[];
  }[] = [];
  if (description)
    defs.push({ tag: 0x010e, type: 2, count: 2, val: () => asciiVal("c\0") });
  if (make)
    defs.push({ tag: 0x010f, type: 2, count: 3, val: () => asciiVal("Ax\0") });
  if (model)
    defs.push({ tag: 0x0110, type: 2, count: 3, val: () => asciiVal("M1\0") });
  if (orientation !== undefined)
    defs.push({
      tag: 0x0112,
      type: 3,
      count: 1,
      val: () => [...w16(le, orientation), 0, 0],
    });
  if (dates)
    defs.push({ tag: 0x0132, type: 2, count: 2, val: () => asciiVal("d\0") });

  const ifd0Count = defs.length + (exifSub ? 1 : 0) + (gps ? 1 : 0);
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const gpsSize = 2 + 2 * 12 + 4;
  const exifSize = 2 + 2 * 12 + 4;

  let cursor = 8 + ifd0Size;
  let gpsOffset = 0;
  let exifOffset = 0;
  if (gps) {
    gpsOffset = cursor;
    cursor += gpsSize;
  }
  if (exifSub) {
    exifOffset = cursor;
    cursor += exifSize;
  }
  if (exifSub)
    defs.push({
      tag: 0x8769,
      type: 4,
      count: 1,
      val: () => w32(le, exifOffset),
    });
  if (gps)
    defs.push({
      tag: 0x8825,
      type: 4,
      count: 1,
      val: () => w32(le, gpsOffset),
    });

  const ifd0: number[] = [...w16(le, defs.length)];
  for (const e of defs)
    ifd0.push(
      ...w16(le, e.tag),
      ...w16(le, e.type),
      ...w32(le, e.count),
      ...e.val(),
    );
  ifd0.push(...w32(le, 0));

  const gpsIfd: number[] = gps
    ? [
        ...w16(le, 2),
        ...w16(le, 0x0000),
        ...w16(le, 1),
        ...w32(le, 4),
        2,
        3,
        0,
        0, // GPSVersionID
        ...w16(le, 0x0001),
        ...w16(le, 2),
        ...w32(le, 2),
        ...asciiVal("N\0"), // GPSLatitudeRef
        ...w32(le, 0),
      ]
    : [];

  const exifIfd: number[] = exifSub
    ? [
        ...w16(le, 2),
        ...w16(le, 0x9003),
        ...w16(le, 2),
        ...w32(le, 2),
        ...asciiVal("d\0"), // DateTimeOriginal
        ...w16(le, 0x9286),
        ...w16(le, 2),
        ...w32(le, 2),
        ...asciiVal("u\0"), // UserComment
        ...w32(le, 0),
      ]
    : [];

  const header: number[] = [
    ...(le ? asciiBytes("II") : asciiBytes("MM")),
    ...w16(le, 42),
    ...w32(le, 8),
  ];
  return Uint8Array.from([...header, ...ifd0, ...gpsIfd, ...exifIfd]);
}

/** FF <marker> <2-byte length> <payload> — one JPEG segment. */
function seg(marker: number, payload: number[]): Uint8Array {
  const len = payload.length + 2;
  return Uint8Array.from([
    0xff,
    marker,
    (len >> 8) & 0xff,
    len & 0xff,
    ...payload,
  ]);
}

const ICC_SEG = seg(0xe2, [
  ...asciiBytes("ICC_PROFILE\0"),
  1,
  1,
  0xaa,
  0xbb,
  0xcc,
  0xdd,
]);
const SOF0_SEG = seg(
  0xc0,
  [0x08, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
);
// SOS marker through EOI — the entropy-coded image data, copied verbatim by strip.
const SOS_TAIL = Uint8Array.from([
  0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0, 0xab, 0xcd, 0xef,
  0xff, 0x00, 0xff, 0xd9,
]);

interface JpegOpts extends TiffOpts {
  com?: boolean;
  xmp?: boolean;
  icc?: boolean;
  exif?: boolean;
}

function buildJpeg(opts: JpegOpts = {}): Uint8Array {
  const { com = true, xmp = true, icc = true, exif = true, ...tiff } = opts;
  const parts: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])]; // SOI
  if (exif)
    parts.push(seg(0xe1, [...asciiBytes("Exif\0\0"), ...buildExifTiff(tiff)]));
  if (xmp)
    parts.push(
      seg(0xe1, [
        ...asciiBytes("http://ns.adobe.com/xap/1.0/\0"),
        ...asciiBytes("<x:xmpmeta/>"),
      ]),
    );
  if (icc) parts.push(ICC_SEG);
  if (com) parts.push(seg(0xfe, asciiBytes("shot at home")));
  parts.push(SOF0_SEG);
  parts.push(SOS_TAIL);
  return concatBytes(...parts);
}

/** The exact 36-byte minimal APP1-Exif that the stripper re-emits to preserve orientation. */
function orientationBlock(o: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    (o >> 8) & 0xff,
    o & 0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

function pngChunk(type: string, data: number[]): Uint8Array {
  // CRC is a placeholder: the walker only DROPS chunks, so it never verifies or
  // recomputes a CRC — kept chunks pass through byte-for-byte.
  return Uint8Array.from([
    ...w32(false, data.length),
    ...asciiBytes(type),
    ...data,
    0,
    0,
    0,
    0,
  ]);
}

const PNG_ICCP = pngChunk("iCCP", [
  ...asciiBytes("prof\0"),
  0,
  0x78,
  0x9c,
  0x00,
]);
const PNG_IDAT = pngChunk(
  "IDAT",
  [0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01],
);
const PNG_IEND = pngChunk("IEND", []);

function buildPng(
  opts: { exif?: boolean; text?: boolean } & TiffOpts = {},
): Uint8Array {
  const { exif = true, text = true, ...tiff } = opts;
  const parts: Uint8Array[] = [Uint8Array.from(PNG_SIG)];
  parts.push(pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  parts.push(PNG_ICCP);
  if (exif) parts.push(pngChunk("eXIf", [...buildExifTiff(tiff)]));
  if (text)
    parts.push(pngChunk("tEXt", asciiBytes("Comment\0taken in Sydney")));
  parts.push(PNG_IDAT);
  parts.push(PNG_IEND);
  return concatBytes(...parts);
}

function webpChunk(fourcc: string, data: number[]): Uint8Array {
  const bytes = [...asciiBytes(fourcc), ...w32(true, data.length), ...data];
  if (data.length & 1) bytes.push(0); // pad to even length
  return Uint8Array.from(bytes);
}

// odd-length payload so its pad byte exercises the RIFF padding path
const WEBP_VP8 = webpChunk("VP8 ", [0xaa, 0xbb, 0xcc, 0xdd, 0x11]);

function buildWebp(
  opts: {
    exif?: boolean;
    xmp?: boolean;
    vp8x?: boolean;
    vp8xFlags?: number;
  } & TiffOpts = {},
): Uint8Array {
  const {
    exif = true,
    xmp = true,
    vp8x = true,
    vp8xFlags = 0x08 | 0x04 | 0x20,
    ...tiff
  } = opts;
  const body: Uint8Array[] = [];
  if (vp8x)
    body.push(webpChunk("VP8X", [vp8xFlags, 0, 0, 0, 0, 0, 1, 0, 0, 1]));
  body.push(WEBP_VP8);
  if (exif) body.push(webpChunk("EXIF", [...buildExifTiff(tiff)]));
  if (xmp) body.push(webpChunk("XMP ", asciiBytes("<x:xmpmeta/>")));
  const bodyBytes = concatBytes(...body);
  const header = Uint8Array.from([
    ...asciiBytes("RIFF"),
    ...w32(true, 4 + bodyBytes.length),
    ...asciiBytes("WEBP"),
  ]);
  return concatBytes(header, bodyBytes);
}

const CLEAN: MetaFindings = {
  gps: false,
  make: false,
  model: false,
  dates: false,
  comments: false,
};

// ===========================================================================

describe("sniff", () => {
  it("classifies the three understood containers", () => {
    expect(sniff(buildJpeg())).toBe("jpeg");
    expect(sniff(buildPng())).toBe("png");
    expect(sniff(buildWebp())).toBe("webp");
  });

  it("reports HEIC/AVIF and anything else as unknown (the honest gap)", () => {
    const heic = Uint8Array.from([
      0,
      0,
      0,
      0x18,
      ...asciiBytes("ftyp"),
      ...asciiBytes("heic"),
      0,
      0,
      0,
      0,
    ]);
    expect(sniff(heic)).toBe("unknown");
    expect(sniff(Uint8Array.from([1, 2, 3, 4, 5]))).toBe("unknown");
    expect(sniff(new Uint8Array())).toBe("unknown");
  });
});

describe("inspect — JPEG", () => {
  it("names GPS, device, dates, and comments when present", () => {
    const found = inspect(buildJpeg({ orientation: 6 }));
    expect(found).toEqual({
      gps: true,
      make: true,
      model: true,
      dates: true,
      comments: true,
    });
  });

  it("reads little-endian TIFF as well as big-endian", () => {
    expect(inspect(buildJpeg({ le: true })).gps).toBe(true);
    expect(inspect(buildJpeg({ le: true })).make).toBe(true);
  });

  it("finds dates + comments through an Exif sub-IFD pointer, not just IFD0", () => {
    const j = buildJpeg({
      make: false,
      model: false,
      gps: false,
      dates: false,
      com: false,
      xmp: false,
      exifSub: true,
    });
    const found = inspect(j);
    expect(found.dates).toBe(true); // DateTimeOriginal (0x9003)
    expect(found.comments).toBe(true); // UserComment (0x9286)
    expect(found.gps).toBe(false);
    expect(found.make).toBe(false);
  });

  it("reports nothing for a JPEG carrying no metadata", () => {
    const clean = buildJpeg({ exif: false, xmp: false, com: false });
    expect(inspect(clean)).toEqual(CLEAN);
  });
});

describe("strip — JPEG", () => {
  it("removes EXIF/XMP/IPTC/COM while inspect(strip) comes back clean", () => {
    const j = buildJpeg({ orientation: 6 });
    const out = strip(j);
    expect(inspect(out)).toEqual(CLEAN);
    expect(out.length).toBeLessThan(j.length);
    // the original EXIF payload is gone (the only "Exif\0\0" left is our tiny
    // orientation block, which carries nothing identifying)
    expect(indexOfSub(out, buildExifTiff({ orientation: 6 }))).toBe(-1);
  });

  it("keeps the ICC profile and the compressed image data byte-identical", () => {
    const out = strip(buildJpeg({ orientation: 6 }));
    expect(indexOfSub(out, ICC_SEG)).toBeGreaterThanOrEqual(0);
    expect(indexOfSub(out, SOF0_SEG)).toBeGreaterThanOrEqual(0);
    // the entropy-coded scan is the exact tail of the output
    expect(out.slice(out.length - SOS_TAIL.length)).toEqual(SOS_TAIL);
  });

  it("preserves orientation via a minimal 1-tag EXIF block right after SOI", () => {
    const out = strip(buildJpeg({ orientation: 6 }));
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(indexOfSub(out, orientationBlock(6))).toBe(2);
  });

  it("writes no orientation block when orientation is absent or normal (1)", () => {
    const noneOut = strip(buildJpeg({ orientation: undefined }));
    const normOut = strip(buildJpeg({ orientation: 1 }));
    // no "Exif\0\0" survives when there's no rotation worth keeping
    expect(indexOfSub(noneOut, Uint8Array.from(asciiBytes("Exif\0\0")))).toBe(
      -1,
    );
    expect(indexOfSub(normOut, Uint8Array.from(asciiBytes("Exif\0\0")))).toBe(
      -1,
    );
  });

  it("leaves a metadata-free JPEG byte-identical", () => {
    const clean = buildJpeg({ exif: false, xmp: false, com: false });
    expect(strip(clean)).toEqual(clean);
  });

  it("is idempotent", () => {
    const once = strip(buildJpeg({ orientation: 8 }));
    expect(strip(once)).toEqual(once);
  });
});

describe("inspect + strip — PNG", () => {
  it("names metadata from eXIf + text chunks", () => {
    expect(inspect(buildPng())).toEqual({
      gps: true,
      make: true,
      model: true,
      dates: true,
      comments: true,
    });
  });

  it("drops eXIf + tEXt, keeps signature, iCCP, IDAT, IEND byte-identical", () => {
    const png = buildPng();
    const out = strip(png);
    expect(inspect(out)).toEqual(CLEAN);
    expect(out.slice(0, 8)).toEqual(Uint8Array.from(PNG_SIG));
    expect(indexOfSub(out, PNG_ICCP)).toBeGreaterThanOrEqual(0);
    expect(indexOfSub(out, PNG_IDAT)).toBeGreaterThanOrEqual(0);
    expect(indexOfSub(out, PNG_IEND)).toBeGreaterThanOrEqual(0);
    // both metadata chunk types are gone
    expect(indexOfSub(out, Uint8Array.from(asciiBytes("eXIf")))).toBe(-1);
    expect(indexOfSub(out, Uint8Array.from(asciiBytes("tEXt")))).toBe(-1);
  });

  it("leaves a metadata-free PNG byte-identical and is idempotent", () => {
    const clean = buildPng({ exif: false, text: false });
    expect(strip(clean)).toEqual(clean);
    const once = strip(buildPng());
    expect(strip(once)).toEqual(once);
  });
});

describe("inspect + strip — WebP", () => {
  it("names metadata from EXIF + XMP chunks", () => {
    expect(inspect(buildWebp())).toEqual({
      gps: true,
      make: true,
      model: true,
      dates: true,
      comments: true,
    });
  });

  it("drops EXIF/XMP, clears VP8X flags, fixes RIFF size, keeps VP8 verbatim", () => {
    const out = strip(buildWebp());
    expect(inspect(out)).toEqual(CLEAN);
    expect(indexOfSub(out, WEBP_VP8)).toBeGreaterThanOrEqual(0);
    expect(indexOfSub(out, Uint8Array.from(asciiBytes("EXIF")))).toBe(-1);
    expect(indexOfSub(out, Uint8Array.from(asciiBytes("XMP ")))).toBe(-1);
    // VP8X is the first body chunk: flags byte sits at offset 20 (12 header + 8 chunk header)
    expect(out[20]).toBe(0x20); // EXIF (0x08) + XMP (0x04) cleared, ICC (0x20) kept
    // RIFF size field == everything after the first 8 bytes
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(riffSize).toBe(out.length - 8);
  });

  it("leaves a WebP with no metadata byte-identical and is idempotent", () => {
    // simple form (no VP8X, no metadata) has nothing to touch
    const simple = concatBytes(
      Uint8Array.from([
        ...asciiBytes("RIFF"),
        ...w32(true, 4 + WEBP_VP8.length),
        ...asciiBytes("WEBP"),
      ]),
      WEBP_VP8,
    );
    expect(strip(simple)).toEqual(simple);
    const once = strip(buildWebp());
    expect(strip(once)).toEqual(once);
  });
});

describe("pass-through — unknown, empty, malformed", () => {
  it("returns unknown formats and empty input untouched (same reference)", () => {
    const junk = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    expect(strip(junk)).toBe(junk);
    expect(inspect(junk)).toEqual(CLEAN);
    const empty = new Uint8Array();
    expect(strip(empty)).toBe(empty);
    expect(inspect(empty)).toEqual(CLEAN);
  });

  it("passes a HEIC container through untouched (the documented gap)", () => {
    const heic = Uint8Array.from([
      0,
      0,
      0,
      0x18,
      ...asciiBytes("ftyp"),
      ...asciiBytes("heic"),
      0,
      0,
      0,
      0,
    ]);
    expect(strip(heic)).toBe(heic);
  });

  it("passes truncated/malformed JPEG, PNG, and WebP through untouched", () => {
    // JPEG APP1 that declares a length past the buffer
    const badJpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78,
    ]);
    expect(strip(badJpeg)).toBe(badJpeg);

    // PNG signature + a chunk whose declared length overruns
    const badPng = Uint8Array.from([
      ...PNG_SIG,
      0xff,
      0xff,
      0xff,
      0xff,
      ...asciiBytes("eXIf"),
    ]);
    expect(strip(badPng)).toBe(badPng);

    // WebP whose chunk size overruns the buffer
    const badWebp = Uint8Array.from([
      ...asciiBytes("RIFF"),
      0x20,
      0,
      0,
      0,
      ...asciiBytes("WEBP"),
      ...asciiBytes("EXIF"),
      0xff,
      0xff,
      0xff,
      0xff,
    ]);
    expect(strip(badWebp)).toBe(badWebp);
  });
});
