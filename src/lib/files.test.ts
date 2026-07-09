import { describe, expect, it } from "vitest";
import {
  age,
  displayName,
  fileKind,
  formatSize,
  isTextNote,
  isValidPathname,
  noteName,
  sanitizePathname,
  sortInbox,
  TEXT_NOTE_MAX,
  toInboxFile,
} from "./files";

describe("sanitizePathname", () => {
  it("keeps only the basename across both slash kinds", () => {
    expect(sanitizePathname("/var/tmp/photo.jpg")).toBe("photo.jpg");
    expect(sanitizePathname("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });
  it("folds unsafe chars to dashes and collapses runs", () => {
    expect(sanitizePathname("my file (final)!!.txt")).toBe("my-file-final.txt");
  });
  it("preserves a real extension, casing and all", () => {
    expect(sanitizePathname("Vacation.JPG")).toBe("Vacation.JPG");
  });
  it("folds a bogus/overlong extension back into the stem", () => {
    expect(sanitizePathname("mydata.superlongextension")).toBe(
      "mydata.superlongextension",
    );
  });
  it("strips leading dots so nothing becomes a hidden file", () => {
    expect(sanitizePathname(".env")).toBe("env");
  });
  it("truncates a long stem to 200 chars but keeps the extension", () => {
    const r = sanitizePathname("a".repeat(300) + ".png");
    expect(r.length).toBe(200);
    expect(r.endsWith(".png")).toBe(true);
  });
  it("turns unicode input into a safe, non-empty name", () => {
    expect(sanitizePathname("café.jpg")).toBe("caf.jpg");
    const emoji = sanitizePathname("📷🎉.png");
    expect(emoji).toBe("file.png"); // stem vanishes, valid ext survives
    expect(isValidPathname("inbox/" + emoji)).toBe(true);
  });
  it("falls back to 'file' when nothing survives", () => {
    expect(sanitizePathname("")).toBe("file");
  });
  it("collapses dot runs so output always passes isValidPathname", () => {
    expect(sanitizePathname("report..final.pdf")).toBe("report.final.pdf");
    for (const nasty of [
      "report..final.pdf",
      "..hidden..name..",
      "a. .b.png",
      "..\\..\\evil.exe",
    ]) {
      expect(isValidPathname("inbox/" + sanitizePathname(nasty))).toBe(true);
    }
  });
});

describe("isValidPathname", () => {
  it("accepts a stored inbox leaf", () => {
    expect(isValidPathname("inbox/photo-x1.jpg")).toBe(true);
  });
  it("rejects anything off the happy path", () => {
    expect(isValidPathname("photo.jpg")).toBe(false); // no prefix
    expect(isValidPathname("inbox/../x")).toBe(false); // traversal
    expect(isValidPathname("inbox/sub/x.jpg")).toBe(false); // embedded slash
    expect(isValidPathname("inbox/a b.jpg")).toBe(false); // space
    expect(isValidPathname("inbox/%2e%2e")).toBe(false); // percent probe
    expect(isValidPathname("inbox/" + "a".repeat(251))).toBe(false); // too long
    expect(isValidPathname("inbox/")).toBe(false); // empty remainder
  });
});

describe("noteName", () => {
  it("slugs plain text and appends .txt", () => {
    expect(noteName("hello world")).toBe("hello-world.txt");
  });
  it("keeps a pasted URL's host — no basename collapse", () => {
    const n = noteName("https://example.com/a/b");
    expect(n).toContain("example.com");
    expect(n.endsWith(".txt")).toBe(true);
  });
  it("truncates the stem past 40 chars but keeps .txt", () => {
    expect(noteName("x".repeat(60))).toBe("x".repeat(40) + ".txt");
  });
  it("falls back to note.txt for empty or whitespace-only text", () => {
    expect(noteName("")).toBe("note.txt");
    expect(noteName("   \n\t ")).toBe("note.txt");
  });
  it("always yields a valid inbox leaf, even for nasty input", () => {
    for (const nasty of [
      "report..final.pdf",
      "..hidden..name..",
      "a. .b.png",
      "..\\..\\evil.exe",
    ]) {
      expect(isValidPathname("inbox/" + noteName(nasty))).toBe(true);
    }
  });
});

describe("isTextNote", () => {
  it("is true for a .txt within the size ceiling", () => {
    expect(isTextNote({ pathname: "inbox/note.txt", size: 100 })).toBe(true);
    expect(
      isTextNote({ pathname: "inbox/note.txt", size: TEXT_NOTE_MAX }),
    ).toBe(true);
  });
  it("matches the extension case-insensitively", () => {
    expect(isTextNote({ pathname: "inbox/NOTE.TXT", size: 100 })).toBe(true);
  });
  it("is false over the ceiling or at zero size", () => {
    expect(
      isTextNote({ pathname: "inbox/note.txt", size: TEXT_NOTE_MAX + 1 }),
    ).toBe(false);
    expect(isTextNote({ pathname: "inbox/note.txt", size: 0 })).toBe(false);
  });
  it("is false for a non-txt file", () => {
    expect(isTextNote({ pathname: "inbox/x.pdf", size: 100 })).toBe(false);
  });
});

describe("fileKind", () => {
  it("buckets one extension per kind", () => {
    expect(fileKind("inbox/x.png")).toBe("image");
    expect(fileKind("inbox/x.pdf")).toBe("doc");
    expect(fileKind("inbox/x.zip")).toBe("archive");
    expect(fileKind("inbox/x.mp3")).toBe("audio");
    expect(fileKind("inbox/x.mp4")).toBe("video");
  });
  it("is case-insensitive", () => {
    expect(fileKind("inbox/PHOTO.JPG")).toBe("image");
  });
  it("is 'other' for an unknown or missing extension", () => {
    expect(fileKind("inbox/x.xyz")).toBe("other");
    expect(fileKind("inbox/README")).toBe("other");
  });
});

describe("displayName", () => {
  it("leaves a plain name untouched", () => {
    expect(displayName("inbox/photo.jpg")).toBe("photo.jpg");
  });
  it("strips a Vercel Blob random suffix before the extension", () => {
    expect(displayName("inbox/report-aBcDeFgHiJkLmNoPqRsT.pdf")).toBe(
      "report.pdf",
    );
  });
});

describe("formatSize", () => {
  it("uses whole bytes and one decimal above", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(823.5 * 1024)).toBe("823.5 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 ** 3)).toBe("1.0 GB");
  });
  it("floors garbage to 0 B", () => {
    expect(formatSize(-5)).toBe("0 B");
    expect(formatSize(NaN)).toBe("0 B");
  });
});

describe("age", () => {
  const now = Date.parse("2026-07-09T12:00:00Z");
  it("crosses each boundary", () => {
    expect(age("2026-07-09T11:59:30Z", now)).toBe("just now"); // 30s
    expect(age("2026-07-09T11:59:00Z", now)).toBe("1m ago"); // 60s
    expect(age("2026-07-09T11:00:00Z", now)).toBe("1h ago"); // 60m
    expect(age("2026-07-08T12:00:00Z", now)).toBe("1d ago"); // 24h
    expect(age("2026-07-02T12:00:00Z", now)).toBe("1w ago"); // 7d
    expect(age("2026-06-25T12:00:00Z", now)).toBe("2w ago"); // 14d
  });
  it("reads future and invalid timestamps as just now", () => {
    expect(age("2026-07-09T12:05:00Z", now)).toBe("just now");
    expect(age("not-a-date", now)).toBe("just now");
  });
});

describe("toInboxFile", () => {
  it("maps a raw entry, normalizing name, kind, and the date", () => {
    const f = toInboxFile({
      pathname: "inbox/report-aBcDeFgHiJkLmNoPqRsT.pdf",
      url: "https://blob/report.pdf",
      size: 2048,
      uploadedAt: "2026-07-09T00:00:00.000Z",
    });
    expect(f.name).toBe("report.pdf");
    expect(f.kind).toBe("doc");
    expect(f.size).toBe(2048);
    expect(f.url).toBe("https://blob/report.pdf");
    expect(f.pathname).toBe("inbox/report-aBcDeFgHiJkLmNoPqRsT.pdf");
    expect(f.uploadedAt).toBe("2026-07-09T00:00:00.000Z");
  });
  it("accepts a Date for uploadedAt", () => {
    const f = toInboxFile({
      pathname: "inbox/clip.mp4",
      url: "u",
      size: 1,
      uploadedAt: new Date("2026-07-09T00:00:00.000Z"),
    });
    expect(f.uploadedAt).toBe("2026-07-09T00:00:00.000Z");
    expect(f.kind).toBe("video");
  });
});

describe("sortInbox", () => {
  const mk = (pathname: string, uploadedAt: string) =>
    toInboxFile({ pathname, url: "u", size: 1, uploadedAt });

  it("returns a new array, newest first", () => {
    const files = [
      mk("inbox/a.png", "2026-07-01T00:00:00Z"),
      mk("inbox/b.png", "2026-07-09T00:00:00Z"),
      mk("inbox/c.png", "2026-07-05T00:00:00Z"),
    ];
    expect(sortInbox(files).map((f) => f.pathname)).toEqual([
      "inbox/b.png",
      "inbox/c.png",
      "inbox/a.png",
    ]);
    expect(files[0].pathname).toBe("inbox/a.png"); // input untouched
  });
});
