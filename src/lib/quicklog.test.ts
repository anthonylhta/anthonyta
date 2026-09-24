import { describe, expect, it } from "vitest";
import { MAX_NOW_KEY, MAX_NOW_TEXT } from "./now";
import { parseQuickLog, quickLogLabel, quickLogSaved } from "./quicklog";
import { MAX_STUDY_SOURCE } from "./study";
import { MAX_TEXT } from "./todo";

const TODAY = "2026-09-15";

describe("parseQuickLog — the weigh-in verb", () => {
  it("reads `w 67.4` as today's weigh-in", () => {
    expect(parseQuickLog("w 67.4", TODAY)).toEqual({
      kind: "weigh",
      kg: 67.4,
      day: TODAY,
    });
  });

  it("takes a whole number, and `weigh` spelled out", () => {
    expect(parseQuickLog("W 67", TODAY)).toEqual({
      kind: "weigh",
      kg: 67,
      day: TODAY,
    });
    expect(parseQuickLog("weigh 67.4", TODAY)).toEqual({
      kind: "weigh",
      kg: 67.4,
      day: TODAY,
    });
  });

  it("trims the query and tolerates the space between", () => {
    expect(parseQuickLog("  w   67.4  ", TODAY)).toEqual({
      kind: "weigh",
      kg: 67.4,
      day: TODAY,
    });
  });

  it("is not an action until there is a figure", () => {
    expect(parseQuickLog("w", TODAY)).toBeNull();
    expect(parseQuickLog("w ", TODAY)).toBeNull();
    expect(parseQuickLog("w abc", TODAY)).toBeNull();
  });

  it("refuses a figure no body has", () => {
    expect(parseQuickLog("w 400", TODAY)).toBeNull();
    expect(parseQuickLog("w 29", TODAY)).toBeNull();
    expect(parseQuickLog("w 0", TODAY)).toBeNull();
  });

  it("refuses precision a scale does not have", () => {
    expect(parseQuickLog("w 67.45", TODAY)).toBeNull();
  });

  it("takes the figure alone — no units, no trailing words", () => {
    expect(parseQuickLog("w 67.4 kg", TODAY)).toBeNull();
  });
});

describe("parseQuickLog — the capture verb", () => {
  it("reads the rest of the line as the capture", () => {
    expect(parseQuickLog("todo call the tailor", TODAY)).toEqual({
      kind: "todo",
      text: "call the tailor",
    });
  });

  it("trims the captured text", () => {
    expect(parseQuickLog("todo   call the tailor   ", TODAY)).toEqual({
      kind: "todo",
      text: "call the tailor",
    });
  });

  it("clips to the list's own per-capture cap", () => {
    const long = "x".repeat(MAX_TEXT + 50);
    const action = parseQuickLog(`todo ${long}`, TODAY);
    expect(action).toEqual({ kind: "todo", text: "x".repeat(MAX_TEXT) });
  });

  it("is not an action with nothing to capture", () => {
    expect(parseQuickLog("todo", TODAY)).toBeNull();
    expect(parseQuickLog("todo   ", TODAY)).toBeNull();
  });
});

describe("parseQuickLog — the front-door verb", () => {
  it("reads the first word as the key and the rest as the line", () => {
    expect(parseQuickLog("now reading a new serial", TODAY)).toEqual({
      kind: "now",
      key: "reading",
      text: "a new serial",
    });
  });

  it("lowercases the key and trims both halves", () => {
    expect(parseQuickLog("  now   Reading   a new serial  ", TODAY)).toEqual({
      kind: "now",
      key: "reading",
      text: "a new serial",
    });
  });

  it("is not an action until there is something to say", () => {
    expect(parseQuickLog("now", TODAY)).toBeNull();
    expect(parseQuickLog("now   ", TODAY)).toBeNull();
    expect(parseQuickLog("now reading", TODAY)).toBeNull();
  });

  it("refuses a key or a line past the block's caps", () => {
    const longKey = "k".repeat(MAX_NOW_KEY + 1);
    const longText = "t".repeat(MAX_NOW_TEXT + 1);
    expect(parseQuickLog(`now ${longKey} a line`, TODAY)).toBeNull();
    expect(parseQuickLog(`now reading ${longText}`, TODAY)).toBeNull();
  });

  it("takes both halves at exactly the cap", () => {
    const key = "k".repeat(MAX_NOW_KEY);
    const text = "t".repeat(MAX_NOW_TEXT);
    expect(parseQuickLog(`now ${key} ${text}`, TODAY)).toEqual({
      kind: "now",
      key,
      text,
    });
  });
});

describe("parseQuickLog — the cast verb", () => {
  it("reads the last figure as dollars and the rest as the name", () => {
    expect(parseQuickLog("cast the cinema — Resident Evil 0", TODAY)).toEqual({
      kind: "cast",
      name: "the cinema — Resident Evil",
      stones: 0,
      day: TODAY,
    });
    expect(parseQuickLog("cast karaoke 25.50", TODAY)).toEqual({
      kind: "cast",
      name: "karaoke",
      stones: 2550,
      day: TODAY,
    });
  });

  it("takes any case, trims, and keeps a name's own numbers", () => {
    expect(parseQuickLog("  CAST   Resident Evil 2   18.5 ", TODAY)).toEqual({
      kind: "cast",
      name: "Resident Evil 2",
      stones: 1850,
      day: TODAY,
    });
  });

  it("is not an action until there is a name and a figure", () => {
    expect(parseQuickLog("cast", TODAY)).toBeNull();
    expect(parseQuickLog("cast   ", TODAY)).toBeNull();
    expect(parseQuickLog("cast karaoke", TODAY)).toBeNull();
    expect(parseQuickLog("cast 25", TODAY)).toBeNull();
    expect(parseQuickLog("cast karaoke 25.505", TODAY)).toBeNull();
    expect(parseQuickLog("cast karaoke $25", TODAY)).toBeNull();
  });

  it("refuses a name past the cap rather than clipping it", () => {
    expect(parseQuickLog(`cast ${"x".repeat(201)} 5`, TODAY)).toBeNull();
    expect(parseQuickLog(`cast ${"x".repeat(200)} 5`, TODAY)).toEqual({
      kind: "cast",
      name: "x".repeat(200),
      stones: 500,
      day: TODAY,
    });
  });

  it("refuses a figure past the book's stones bound", () => {
    expect(parseQuickLog("cast a car 10000000", TODAY)).toBeNull();
  });
});

describe("parseQuickLog — everything else is navigation", () => {
  it("leaves an ordinary query alone", () => {
    expect(parseQuickLog("", TODAY)).toBeNull();
    expect(parseQuickLog("projects", TODAY)).toBeNull();
    expect(parseQuickLog("weekly", TODAY)).toBeNull();
    expect(parseQuickLog("67.4", TODAY)).toBeNull();
  });
});

describe("quickLogLabel", () => {
  it("spells out the weigh-in with the day it lands on", () => {
    expect(quickLogLabel({ kind: "weigh", kg: 67.4, day: TODAY })).toBe(
      "log weigh-in · 67.4 kg · tue 15 sep",
    );
  });

  it("spells out the capture", () => {
    expect(quickLogLabel({ kind: "todo", text: "call the tailor" })).toBe(
      "capture · call the tailor",
    );
  });

  it("spells out the now line, clipped to the palette's row", () => {
    expect(
      quickLogLabel({ kind: "now", key: "reading", text: "a new serial" }),
    ).toBe("set now · reading · a new serial");
    expect(
      quickLogLabel({ kind: "now", key: "reading", text: "t".repeat(80) }),
    ).toBe(`set now · reading · ${"t".repeat(59)}…`);
  });
});

describe("quickLogLabel — the cast", () => {
  it("spells out the cast with its stones and day", () => {
    expect(
      quickLogLabel({
        kind: "cast",
        name: "karaoke",
        stones: 2550,
        day: TODAY,
      }),
    ).toBe("cast · karaoke · $25.50 · tue 15 sep");
    expect(
      quickLogLabel({
        kind: "cast",
        name: "the cinema",
        stones: 0,
        day: TODAY,
      }),
    ).toBe("cast · the cinema · $0.00 · tue 15 sep");
  });
});

describe("parseQuickLog — the study verb", () => {
  it("reads `ja <source> 20m` as today's sitting with its minutes", () => {
    expect(parseQuickLog("ja 東洋経済 article 20m", TODAY)).toEqual({
      kind: "study",
      source: "東洋経済 article",
      minutes: 20,
      day: TODAY,
    });
    expect(parseQuickLog("JA graded reader 45 min", TODAY)).toEqual({
      kind: "study",
      source: "graded reader",
      minutes: 45,
      day: TODAY,
    });
  });

  it("takes a source alone, numbers inside it included", () => {
    expect(parseQuickLog("ja anki", TODAY)).toEqual({
      kind: "study",
      source: "anki",
      day: TODAY,
    });
    expect(parseQuickLog("ja genki chapter 12", TODAY)).toEqual({
      kind: "study",
      source: "genki chapter 12",
      day: TODAY,
    });
  });

  it("is not an action until something studied is named", () => {
    expect(parseQuickLog("ja", TODAY)).toBeNull();
    expect(parseQuickLog("ja   ", TODAY)).toBeNull();
    expect(parseQuickLog("ja 20m", TODAY)).toBeNull();
    expect(parseQuickLog("japan", TODAY)).toBeNull();
  });

  it("refuses a sitting of no minutes or past ten hours", () => {
    expect(parseQuickLog("ja anki 0m", TODAY)).toBeNull();
    expect(parseQuickLog("ja anki 601 min", TODAY)).toBeNull();
  });

  it("clips a long source to the log's cap", () => {
    const action = parseQuickLog(`ja ${"x".repeat(250)}`, TODAY);
    expect(action).toEqual({
      kind: "study",
      source: "x".repeat(MAX_STUDY_SOURCE),
      day: TODAY,
    });
  });

  it("labels the row with the minutes only when they were said", () => {
    expect(
      quickLogLabel({
        kind: "study",
        source: "東洋経済 article",
        minutes: 20,
        day: "2026-09-25",
      }),
    ).toBe("study · 東洋経済 article · 20 min · fri 25 sep");
    expect(quickLogLabel({ kind: "study", source: "anki", day: TODAY })).toBe(
      "study · anki · tue 15 sep",
    );
  });
});

describe("quickLogSaved", () => {
  it("marks the weigh-in written", () => {
    expect(quickLogSaved({ kind: "weigh", kg: 67, day: TODAY })).toBe(
      "saved ✓ weigh-in 67 kg · tue 15 sep",
    );
  });

  it("marks the capture written", () => {
    expect(quickLogSaved({ kind: "todo", text: "call the tailor" })).toBe(
      "saved ✓ captured · call the tailor",
    );
  });

  it("marks the now line written", () => {
    expect(
      quickLogSaved({ kind: "now", key: "reading", text: "a new serial" }),
    ).toBe("saved ✓ now · reading · a new serial");
  });

  it("marks the cast written", () => {
    expect(
      quickLogSaved({
        kind: "cast",
        name: "karaoke",
        stones: 2550,
        day: TODAY,
      }),
    ).toBe("saved ✓ cast · karaoke · $25.50 · tue 15 sep");
  });

  it("marks the sitting written", () => {
    expect(
      quickLogSaved({ kind: "study", source: "anki", minutes: 15, day: TODAY }),
    ).toBe("saved ✓ study · anki · 15 min · tue 15 sep");
  });
});
