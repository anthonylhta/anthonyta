import { describe, expect, it } from "vitest";
import {
  emptyCspDay,
  foldReport,
  isCspDay,
  MAX_KEYS,
  normalizeLegacy,
  normalizeReport,
  OVERFLOW_KEY,
  parseReports,
  summarizeCsp,
  type CspDay,
  type NormalizedReport,
} from "./cspreport";

// One violation in each browser's wire shape — legacy `report-uri` and the newer
// Reporting API batch item — for the "they normalize identically" lock.
const VIOLATION = {
  directive: "script-src-elem",
  blocked: "https://evil.example/x.js?token=secret",
  document: "https://anthonyta.dev/notes?q=abc#frag",
} as const;
const legacyOf = (v: typeof VIOLATION) => ({
  "csp-report": {
    "effective-directive": v.directive,
    "blocked-uri": v.blocked,
    "document-uri": v.document,
  },
});
const reportingItem = (v: typeof VIOLATION) => ({
  type: "csp-violation",
  url: v.document,
  body: {
    effectiveDirective: v.directive,
    blockedURL: v.blocked,
    documentURL: v.document,
  },
});

describe("normalize — both wire shapes", () => {
  it("legacy and Reporting API produce the identical record", () => {
    const expected: NormalizedReport = {
      directive: "script-src-elem",
      blockedOrigin: "https://evil.example",
      pagePath: "/notes",
    };
    expect(normalizeLegacy(legacyOf(VIOLATION))).toEqual(expected);
    expect(normalizeReport(reportingItem(VIOLATION))).toEqual(expected);
    expect(parseReports(legacyOf(VIOLATION))).toEqual([expected]);
    expect(parseReports([reportingItem(VIOLATION)])).toEqual([expected]);
  });

  it("falls back to violated-directive, keeping only the directive name", () => {
    const r = normalizeLegacy({
      "csp-report": {
        "violated-directive": "script-src 'self'",
        "blocked-uri": "https://evil.com/a",
        "document-uri": "https://anthonyta.dev/x",
      },
    });
    expect(r?.directive).toBe("script-src");
  });

  it("skips non-csp-violation items in a mixed batch", () => {
    const out = parseReports([
      { type: "deprecation", body: {} },
      reportingItem(VIOLATION),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].directive).toBe("script-src-elem");
  });

  it("caps a Reporting API batch at 10 items", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      type: "csp-violation",
      body: {
        effectiveDirective: "img-src",
        blockedURL: "inline",
        documentURL: `/p${i}`,
      },
    }));
    expect(parseReports(many)).toHaveLength(10);
  });
});

describe("sanitize — hostile input", () => {
  const norm = (blocked: unknown, doc: unknown, dir: unknown = "img-src") =>
    normalizeReport({
      type: "csp-violation",
      body: { effectiveDirective: dir, blockedURL: blocked, documentURL: doc },
    });

  it("strips the blocked URL to its origin (path/query dropped)", () => {
    expect(norm("https://cdn.evil/x.js?k=v", "/")?.blockedOrigin).toBe(
      "https://cdn.evil",
    );
  });

  it("strips the document URL to a path (query AND fragment dropped)", () => {
    expect(norm("inline", "https://anthonyta.dev/vault?t=1#x")?.pagePath).toBe(
      "/vault",
    );
  });

  it("collapses a data: URI to the bare scheme (no base64 payload in the key)", () => {
    expect(norm("data:image/png;base64,AAAABBBB", "/")?.blockedOrigin).toBe(
      "data",
    );
  });

  it("passes CSP keywords (inline, eval, self) through unchanged", () => {
    expect(norm("inline", "/")?.blockedOrigin).toBe("inline");
    expect(norm("eval", "/")?.blockedOrigin).toBe("eval");
    expect(norm("self", "/")?.blockedOrigin).toBe("self");
  });

  it("truncates an oversize directive to 64 chars", () => {
    expect(norm("inline", "/", "x".repeat(200))?.directive.length).toBe(64);
  });

  it("drops a report missing any axis, or with a junk field", () => {
    expect(norm("inline", undefined)).toBeNull(); // no document
    expect(norm(undefined, "/")).toBeNull(); // no blocked
    expect(norm("inline", "/", 123)).toBeNull(); // non-string directive
    expect(norm("inline", 42)).toBeNull(); // non-string document
  });
});

describe("parseReports — junk in, empty out", () => {
  it("returns [] for anything that is neither a batch nor a legacy report", () => {
    for (const x of [null, undefined, "nope", 42, true, {}]) {
      expect(parseReports(x)).toEqual([]);
    }
  });
});

describe("foldReport — upsert + distinct-key cap", () => {
  const rep = (pagePath: string): NormalizedReport => ({
    directive: "img-src",
    blockedOrigin: "https://x",
    pagePath,
  });

  it("increments an existing key and adds new ones", () => {
    const day = emptyCspDay("2026-07-13");
    foldReport(day, rep("/a"));
    foldReport(day, rep("/a"));
    foldReport(day, rep("/b"));
    expect(day.counts["img-src|https://x|/a"]).toBe(2);
    expect(day.counts["img-src|https://x|/b"]).toBe(1);
  });

  it("folds overflow into one bucket past the cap, still counting known keys", () => {
    const day = emptyCspDay("2026-07-13");
    for (let i = 0; i < MAX_KEYS; i++) foldReport(day, rep(`/p${i}`));
    expect(Object.keys(day.counts)).toHaveLength(MAX_KEYS);
    expect(day.counts[OVERFLOW_KEY]).toBeUndefined();

    foldReport(day, rep("/over1"));
    foldReport(day, rep("/over2"));
    expect(Object.keys(day.counts)).toHaveLength(MAX_KEYS + 1);
    expect(day.counts[OVERFLOW_KEY]).toBe(2);

    // A key already present keeps counting even past the cap.
    foldReport(day, rep("/p0"));
    expect(day.counts["img-src|https://x|/p0"]).toBe(2);
  });
});

describe("isCspDay — guard matrix", () => {
  const good: CspDay = {
    v: 1,
    date: "2026-07-13",
    counts: { "img-src|https://x|/": 3 },
  };
  it("accepts a well-formed record, incl. an empty day", () => {
    expect(isCspDay(good)).toBe(true);
    expect(isCspDay(emptyCspDay("2026-07-13"))).toBe(true);
  });
  it("rejects a bad version, date, or count", () => {
    expect(isCspDay({ ...good, v: 2 })).toBe(false);
    expect(isCspDay({ ...good, date: "2026/07/13" })).toBe(false);
    expect(isCspDay({ ...good, counts: { k: -1 } })).toBe(false);
    expect(isCspDay({ ...good, counts: { k: 1.5 } })).toBe(false);
    expect(isCspDay({ ...good, counts: { k: "3" } })).toBe(false);
    expect(isCspDay({ v: 1, date: "2026-07-13" })).toBe(false);
    expect(isCspDay(null)).toBe(false);
  });
});

describe("summarizeCsp — panel aggregation", () => {
  it("groups by directive, orders origins and directives by count", () => {
    const days: CspDay[] = [
      {
        v: 1,
        date: "2026-07-12",
        counts: { "script-src|https://a|/x": 3, "img-src|https://b|/y": 1 },
      },
      {
        v: 1,
        date: "2026-07-13",
        counts: { "script-src|https://a|/x": 2, "script-src|https://c|/z": 6 },
      },
    ];
    const { total, groups } = summarizeCsp(days);
    expect(total).toBe(12);
    expect(groups.map((g) => g.directive)).toEqual(["script-src", "img-src"]);
    expect(groups[0].total).toBe(11);
    expect(groups[0].origins).toEqual([
      { origin: "https://c", count: 6 },
      { origin: "https://a", count: 5 },
    ]);
  });

  it("is empty totals for no days", () => {
    expect(summarizeCsp([])).toEqual({ total: 0, groups: [] });
  });
});
