import { describe, expect, it } from "vitest";
import { parseDaily } from "./today";

// A real daily note, verbatim (the template the parser targets).
const REAL_NOTE = `# Day planner

- [x] 15:00 - 23:00 Work

# Journal

got up around 12 ssmth think bc i went jim last night after work and slept late i didnt feel that great

got ready fast bucket was still at home

# Photos of the Day

## Photos

![[Journals/Images/2026-06-28/20260627_135127.jpg]]
`;

describe("parseDaily — the real daily note", () => {
  const d = parseDaily(REAL_NOTE);

  it("reads the planner item with state and time range", () => {
    expect(d.planner).toEqual([
      { done: true, time: "15:00–23:00", text: "Work" },
    ]);
  });

  it("tallies done/open from checkbox state", () => {
    expect(d.doneCount).toBe(1);
    expect(d.openCount).toBe(0);
  });

  it("takes the first journal line as the muted preview", () => {
    expect(d.journalPreview).toMatch(/^got up around 12 ssmth/);
  });

  it("has no headline (no summary property written)", () => {
    expect(d.summary).toBeNull();
  });

  it("does not pull the journal/photos into the planner", () => {
    expect(d.planner).toHaveLength(1);
  });
});

describe("parseDaily — headline", () => {
  it("lifts a frontmatter summary verbatim", () => {
    const d = parseDaily(
      `---\nsummary: grind day, work the evening\n---\n# Day planner\n- [ ] Work\n`,
    );
    expect(d.summary).toBe("grind day, work the evening");
  });

  it("unquotes a quoted summary", () => {
    const d = parseDaily(`---\nsummary: "quoted line"\n---\n# Journal\nhi\n`);
    expect(d.summary).toBe("quoted line");
  });

  it("ignores other frontmatter keys", () => {
    const d = parseDaily(
      `---\ntags: x\ndate: 2026-06-28\n---\n# Journal\nhi\n`,
    );
    expect(d.summary).toBeNull();
  });

  it("keeps a summary line in the body out of the preview", () => {
    const d = parseDaily(
      `---\nsummary: the day\n---\n# Journal\nactual first line\n`,
    );
    expect(d.journalPreview).toBe("actual first line");
  });
});

describe("parseDaily — planner shapes", () => {
  it("handles an open item with no time", () => {
    const d = parseDaily(`# Day planner\n- [ ] Call the dentist\n`);
    expect(d.planner).toEqual([
      { done: false, time: null, text: "Call the dentist" },
    ]);
    expect(d.openCount).toBe(1);
  });

  it("parses a single start time without a range", () => {
    const d = parseDaily(`# Day planner\n- [ ] 09:00 Standup\n`);
    expect(d.planner[0]).toEqual({
      done: false,
      time: "09:00",
      text: "Standup",
    });
  });

  it("normalises a hyphen range to an en dash", () => {
    const d = parseDaily(`# Day planner\n- [x] 15:00-23:00 Work\n`);
    expect(d.planner[0].time).toBe("15:00–23:00");
  });

  it("mixes done and open across several items", () => {
    const d = parseDaily(
      `# Day planner\n- [x] Gym\n- [ ] 14:00 Dentist\n- [ ] Groceries\n`,
    );
    expect(d.doneCount).toBe(1);
    expect(d.openCount).toBe(2);
  });

  it("accepts the schedule heading alias", () => {
    const d = parseDaily(`# Schedule\n- [ ] 10:00 Meeting\n`);
    expect(d.planner).toHaveLength(1);
  });
});

describe("parseDaily — empty and partial notes", () => {
  it("returns an empty digest for empty input", () => {
    expect(parseDaily("")).toEqual({
      summary: null,
      planner: [],
      doneCount: 0,
      openCount: 0,
      journalPreview: "",
    });
  });

  it("handles a planned-but-not-started morning (planner only, all open)", () => {
    const d = parseDaily(
      `# Day planner\n- [ ] 15:00 - 23:00 Work\n# Journal\n`,
    );
    expect(d.openCount).toBe(1);
    expect(d.doneCount).toBe(0);
    expect(d.journalPreview).toBe("");
  });

  it("survives CRLF line endings", () => {
    const d = parseDaily(`# Day planner\r\n- [x] 09:00 Gym\r\n`);
    expect(d.planner[0]).toEqual({ done: true, time: "09:00", text: "Gym" });
  });
});
