import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOW,
  MAX_NOW_KEY,
  MAX_NOW_LINES,
  MAX_NOW_TEXT,
  normalizeNow,
  removeLine,
  setLine,
  updatedLabel,
  type NowConfig,
} from "./now";

const STAMP = "2026-09-15T00:00:00+10:00";
const AT = new Date("2026-09-16T03:00:00Z");

const cfg = (lines: { key: string; text: string }[]): NowConfig => ({
  v: 1,
  lines,
  updatedAt: STAMP,
});

describe("normalizeNow", () => {
  it("round-trips the defaults through JSON", () => {
    const parsed: unknown = JSON.parse(JSON.stringify(DEFAULT_NOW));
    expect(normalizeNow(parsed)).toEqual(DEFAULT_NOW);
  });

  it("trims both halves and lowercases the key", () => {
    expect(
      normalizeNow({
        v: 1,
        lines: [{ key: "  Open To ", text: "  a role in sydney  " }],
        updatedAt: STAMP,
      }),
    ).toEqual(cfg([{ key: "open to", text: "a role in sydney" }]));
  });

  it("drops a row with an empty half rather than failing the config", () => {
    expect(
      normalizeNow({
        v: 1,
        lines: [
          { key: "open to", text: "a role" },
          { key: "  ", text: "orphaned text" },
          { key: "building", text: "   " },
        ],
        updatedAt: STAMP,
      }),
    ).toEqual(cfg([{ key: "open to", text: "a role" }]));
  });

  it("dedupes keys keep-first", () => {
    expect(
      normalizeNow({
        v: 1,
        lines: [
          { key: "reading", text: "the first one" },
          { key: "READING", text: "the second one" },
        ],
        updatedAt: STAMP,
      }),
    ).toEqual(cfg([{ key: "reading", text: "the first one" }]));
  });

  it("rejects an over-cap block", () => {
    const many = Array.from({ length: MAX_NOW_LINES + 1 }, (_, i) => ({
      key: `k${i}`,
      text: "a line",
    }));
    expect(normalizeNow({ v: 1, lines: many, updatedAt: STAMP })).toBeNull();
  });

  it("rejects an over-cap key or text", () => {
    const longKey = "k".repeat(MAX_NOW_KEY + 1);
    const longText = "t".repeat(MAX_NOW_TEXT + 1);
    expect(
      normalizeNow({
        v: 1,
        lines: [{ key: longKey, text: "x" }],
        updatedAt: STAMP,
      }),
    ).toBeNull();
    expect(
      normalizeNow({
        v: 1,
        lines: [{ key: "k", text: longText }],
        updatedAt: STAMP,
      }),
    ).toBeNull();
  });

  it("measures the caps after trimming", () => {
    const key = ` ${"k".repeat(MAX_NOW_KEY)} `;
    const text = ` ${"t".repeat(MAX_NOW_TEXT)} `;
    expect(
      normalizeNow({ v: 1, lines: [{ key, text }], updatedAt: STAMP }),
    ).toEqual(
      cfg([{ key: "k".repeat(MAX_NOW_KEY), text: "t".repeat(MAX_NOW_TEXT) }]),
    );
  });

  it("rejects an unparseable or missing updatedAt", () => {
    expect(normalizeNow({ v: 1, lines: [], updatedAt: "whenever" })).toBeNull();
    expect(normalizeNow({ v: 1, lines: [] })).toBeNull();
    expect(normalizeNow({ v: 1, lines: [], updatedAt: 0 })).toBeNull();
  });

  it("rejects a shape it does not recognize", () => {
    expect(normalizeNow(null)).toBeNull();
    expect(normalizeNow("now")).toBeNull();
    expect(normalizeNow({ v: 2, lines: [], updatedAt: STAMP })).toBeNull();
    expect(
      normalizeNow({ v: 1, lines: "open to", updatedAt: STAMP }),
    ).toBeNull();
    expect(
      normalizeNow({ v: 1, lines: ["open to"], updatedAt: STAMP }),
    ).toBeNull();
    expect(
      normalizeNow({ v: 1, lines: [{ key: "k" }], updatedAt: STAMP }),
    ).toBeNull();
  });
});

describe("setLine", () => {
  it("replaces the row with that key, in place", () => {
    const before = cfg([
      { key: "open to", text: "old" },
      { key: "reading", text: "a serial" },
    ]);
    expect(setLine(before, "open to", "new", AT)).toEqual({
      v: 1,
      lines: [
        { key: "open to", text: "new" },
        { key: "reading", text: "a serial" },
      ],
      updatedAt: AT.toISOString(),
    });
  });

  it("appends a key the block does not have yet", () => {
    const after = setLine(
      cfg([{ key: "open to", text: "a role" }]),
      "gym",
      "5 a week",
      AT,
    );
    expect(after.lines).toEqual([
      { key: "open to", text: "a role" },
      { key: "gym", text: "5 a week" },
    ]);
  });

  it("cleans the halves the way normalize would", () => {
    const after = setLine(cfg([]), "  Open To  ", "  a role  ", AT);
    expect(after.lines).toEqual([{ key: "open to", text: "a role" }]);
  });

  it("clips an over-long key or text rather than writing past the cap", () => {
    const after = setLine(
      cfg([]),
      "k".repeat(MAX_NOW_KEY + 5),
      "t".repeat(MAX_NOW_TEXT + 5),
      AT,
    );
    expect(after.lines[0].key).toHaveLength(MAX_NOW_KEY);
    expect(after.lines[0].text).toHaveLength(MAX_NOW_TEXT);
  });

  it("is a no-op with an empty half", () => {
    const before = cfg([{ key: "open to", text: "a role" }]);
    expect(setLine(before, "  ", "a role", AT)).toBe(before);
    expect(setLine(before, "open to", "   ", AT)).toBe(before);
  });

  it("is a no-op — the same object — once the block is full", () => {
    const full = cfg(
      Array.from({ length: MAX_NOW_LINES }, (_, i) => ({
        key: `k${i}`,
        text: "a line",
      })),
    );
    expect(setLine(full, "one-more", "a line", AT)).toBe(full);
    // …but a key already in a full block still writes.
    expect(setLine(full, "k0", "rewritten", AT).lines[0]).toEqual({
      key: "k0",
      text: "rewritten",
    });
  });
});

describe("removeLine", () => {
  it("drops the row and stamps the edit", () => {
    const before = cfg([
      { key: "open to", text: "a role" },
      { key: "reading", text: "a serial" },
    ]);
    expect(removeLine(before, "READING", AT)).toEqual({
      v: 1,
      lines: [{ key: "open to", text: "a role" }],
      updatedAt: AT.toISOString(),
    });
  });

  it("is a no-op — the same object — on a key that is not there", () => {
    const before = cfg([{ key: "open to", text: "a role" }]);
    expect(removeLine(before, "gym", AT)).toBe(before);
  });
});

describe("updatedLabel", () => {
  it("names the Sydney day of the instant, month word lowercase", () => {
    expect(updatedLabel(DEFAULT_NOW.updatedAt)).toBe("updated 15 sep 2026");
  });

  it("reads a UTC instant on the Sydney day, not the UTC one", () => {
    // 15 sep 01:30 in Sydney is still 14 sep in UTC — the card says sydney.
    expect(updatedLabel("2026-09-14T15:30:00Z")).toBe("updated 15 sep 2026");
    expect(updatedLabel("2026-09-14T13:00:00Z")).toBe("updated 14 sep 2026");
  });

  it("says nothing at all about a stamp it cannot read", () => {
    expect(updatedLabel("whenever")).toBe("");
  });
});
