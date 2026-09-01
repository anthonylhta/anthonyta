import { describe, expect, it } from "vitest";
import {
  formationRows,
  formationState,
  type FormationEvidence,
} from "./formations";

const TODAY = "2026-09-01";

describe("formations — formationState", () => {
  it("ok within the slack, with the age spoken plainly", () => {
    expect(formationState("2026-09-01", 1, TODAY)).toEqual({
      status: "ok",
      last: "today",
    });
    expect(formationState("2026-08-31", 1, TODAY)).toEqual({
      status: "ok",
      last: "yesterday",
    });
  });

  it("due one turn past the slack, overdue past double", () => {
    expect(formationState("2026-08-30", 1, TODAY).status).toBe("due");
    expect(formationState("2026-08-29", 1, TODAY).status).toBe("due");
    expect(formationState("2026-08-28", 1, TODAY).status).toBe("overdue");
    expect(formationState("2026-08-30", 1, TODAY).last).toBe("2 days silent");
  });

  it("sleep's wider slack: two quiet nights are ordinary", () => {
    expect(formationState("2026-08-30", 2, TODAY).status).toBe("ok");
    expect(formationState("2026-08-29", 2, TODAY).status).toBe("due");
  });

  it("no evidence is unknown, never fresh", () => {
    expect(formationState(null, 1, TODAY)).toEqual({
      status: "unknown",
      last: "no record",
    });
    expect(formationState("junk", 1, TODAY).status).toBe("unknown");
  });
});

describe("formations — formationRows", () => {
  const ev: FormationEvidence = {
    briefingDay: "2026-09-01",
    cronDay: "2026-08-31",
    stepsDay: "2026-09-01",
    sleepDay: "2026-08-30",
    vapid: "ok",
  };

  it("always lists all five, in reading order", () => {
    expect(formationRows(ev, TODAY).map((r) => r.key)).toEqual([
      "briefing",
      "cron",
      "steps",
      "sleep",
      "tripwires",
    ]);
  });

  it("judges each cadenced row by its own slack", () => {
    const rows = formationRows(ev, TODAY);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.briefing.status).toBe("ok");
    expect(by.cron.status).toBe("ok"); // last night's run
    expect(by.sleep.status).toBe("ok"); // 2 nights = sleep's ordinary slack
  });

  it("the tripwires row is config truth, not a cadence", () => {
    const armed = formationRows(ev, TODAY).at(-1)!;
    expect(armed.status).toBe("armed");
    const broken = formationRows({ ...ev, vapid: "misconfigured" }, TODAY).at(
      -1,
    )!;
    expect(broken.status).toBe("broken");
    expect(broken.last).toContain("/system");
    const off = formationRows({ ...ev, vapid: "off" }, TODAY).at(-1)!;
    expect(off.status).toBe("off");
  });

  it("a never-written store reads unknown — silence is visible", () => {
    const rows = formationRows({ ...ev, sleepDay: null }, TODAY);
    expect(rows.find((r) => r.key === "sleep")?.status).toBe("unknown");
  });
});
