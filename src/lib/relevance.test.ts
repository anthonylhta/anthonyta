import { describe, expect, it } from "vitest";
import { matchBriefing } from "./relevance";
import { sampleBriefing, type Briefing } from "./sampleBriefing";

// 120 code points + the single ellipsis.
const TRUNCATE_MAX = 121;

/** A minimal, empty briefing with only the fields under test filled in. */
function mkBriefing(over: Partial<Briefing>): Briefing {
  return {
    date: "2026-06-19",
    weekday: "Fri",
    generated: "06:30",
    driver: "",
    summary: "",
    tape: [],
    bottomLine: [],
    watch: [],
    sections: [],
    ...over,
  };
}

describe("matchBriefing — each scanned field", () => {
  it("matches in the driver", () => {
    const b = mkBriefing({ driver: "NVDA leads the surge" });
    expect(matchBriefing(b, ["NVDA"])).toEqual([
      {
        code: "NVDA",
        hits: [{ where: "driver", text: "NVDA leads the surge" }],
      },
    ]);
  });

  it("matches in the summary", () => {
    const b = mkBriefing({ summary: "risk-on: BTC firmed overnight" });
    expect(matchBriefing(b, ["BTC"])[0].hits[0].where).toBe("summary");
  });

  it("matches a tape label", () => {
    const b = mkBriefing({
      tape: [{ label: "BTC", value: "64.0k", move: -1.8 }],
    });
    expect(matchBriefing(b, ["BTC"])).toEqual([
      { code: "BTC", hits: [{ where: "tape", text: "BTC" }] },
    ]);
  });

  it("matches a bottom-line point", () => {
    const b = mkBriefing({ bottomLine: ["VAS held up as miners wobbled"] });
    expect(matchBriefing(b, ["VAS"])[0].hits[0].where).toBe("bottom line");
  });

  it("matches a watch label", () => {
    const b = mkBriefing({
      watch: [{ date: "23 Jun", label: "NDQ rebalance" }],
    });
    expect(matchBriefing(b, ["NDQ"])[0].hits[0].where).toBe("watch");
  });

  it("matches a section point and names the section as the source", () => {
    const b = mkBriefing({
      sections: [{ title: "equities", points: ["IOZ tracked the ASX lower"] }],
    });
    expect(matchBriefing(b, ["IOZ"])[0].hits[0].where).toBe("equities");
  });
});

describe("matchBriefing — matching rules", () => {
  it("respects token boundaries (NVDA does not match NVDAX)", () => {
    expect(
      matchBriefing(mkBriefing({ summary: "the NVDAX index" }), ["NVDA"]),
    ).toEqual([]);
  });

  it("still matches across surrounding punctuation", () => {
    const b = mkBriefing({ summary: "US-Iran deal; BTC, gold soft" });
    expect(matchBriefing(b, ["BTC"])).toHaveLength(1);
  });

  it("short codes (1–2 chars) match case-sensitively — AU does not match au", () => {
    expect(
      matchBriefing(mkBriefing({ summary: "priced in au dollars" }), ["AU"]),
    ).toEqual([]);
    expect(
      matchBriefing(mkBriefing({ summary: "the AU listing" }), ["AU"]),
    ).toHaveLength(1);
  });

  it("long codes (≥3 chars) match case-insensitively — GOLD matches Gold", () => {
    const b = mkBriefing({ tape: [{ label: "Gold", value: "$4,300" }] });
    expect(matchBriefing(b, ["GOLD"])).toEqual([
      { code: "GOLD", hits: [{ where: "tape", text: "Gold" }] },
    ]);
  });
});

describe("matchBriefing — ordering and dedupe", () => {
  it("orders by hit count desc, then code asc", () => {
    const b = mkBriefing({
      driver: "BTC and VAS lead",
      summary: "BTC again in focus",
      bottomLine: ["BTC still bid"],
      watch: [{ date: "x", label: "ABC event" }],
    });
    // BTC → 3 hits; ABC and VAS → 1 each, tie broken by code asc.
    expect(matchBriefing(b, ["VAS", "BTC", "ABC"]).map((h) => h.code)).toEqual([
      "BTC",
      "ABC",
      "VAS",
    ]);
  });

  it("records at most one hit per source line", () => {
    const b = mkBriefing({ bottomLine: ["BTC rose, then BTC fell"] });
    const r = matchBriefing(b, ["BTC"]);
    expect(r[0].hits).toHaveLength(1);
  });

  it("collapses duplicate codes in the input", () => {
    const b = mkBriefing({ summary: "BTC firmed" });
    expect(matchBriefing(b, ["BTC", "BTC"])).toHaveLength(1);
  });
});

describe("matchBriefing — empty inputs", () => {
  it("returns nothing for empty codes", () => {
    expect(matchBriefing(sampleBriefing, [])).toEqual([]);
  });

  it("returns nothing for an empty briefing", () => {
    expect(matchBriefing(mkBriefing({}), ["BTC"])).toEqual([]);
  });

  it("skips empty-string codes", () => {
    expect(matchBriefing(mkBriefing({ summary: "BTC firmed" }), [""])).toEqual(
      [],
    );
  });
});

describe("matchBriefing — snippet truncation", () => {
  it("truncates a long snippet by code point without splitting a surrogate pair", () => {
    // A UTF-16 slice at 120 would land mid-emoji (prefix "BTC " is 4 units, each
    // emoji is 2), leaving a lone high surrogate. Code-point truncation cannot.
    const long = "BTC " + "😀".repeat(200);
    const r = matchBriefing(mkBriefing({ summary: long }), ["BTC"]);
    const text = r[0].hits[0].text;
    expect([...text].length).toBeLessThanOrEqual(TRUNCATE_MAX);
    for (const cp of [...text]) {
      if (cp.length === 1) {
        const c = cp.charCodeAt(0);
        expect(c < 0xd800 || c > 0xdfff).toBe(true); // no lone surrogate
      }
    }
  });

  it("leaves a short snippet verbatim", () => {
    const b = mkBriefing({ summary: "BTC firmed" });
    expect(matchBriefing(b, ["BTC"])[0].hits[0].text).toBe("BTC firmed");
  });
});
