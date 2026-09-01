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
    fired: null,
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

describe("formations — the tripwires' firing ledger", () => {
  const ev: FormationEvidence = {
    briefingDay: "2026-09-01",
    cronDay: "2026-08-31",
    stepsDay: "2026-09-01",
    sleepDay: "2026-08-30",
    vapid: "ok",
    fired: {
      dropbox: "2026-08-31",
      signin: "2026-08-28",
      briefing: "2026-08-26",
    },
  };
  const wires = (e: FormationEvidence) =>
    formationRows(e, TODAY).find((r) => r.key === "tripwires");

  it("the armed row carries the newest firing", () => {
    expect(wires(ev)?.last).toBe("armed · spoke 1d ago");
  });

  it("unfolds one line per wire, silence naming its source", () => {
    const detail = wires(ev)?.detail;
    expect(detail?.map((d) => d.label)).toEqual([
      "mail",
      "the door",
      "share",
      "silence",
      "upkeep",
      "health",
    ]);
    expect(detail?.find((d) => d.label === "mail")?.value).toBe("1d ago");
    expect(detail?.find((d) => d.label === "silence")?.value).toBe(
      "6d ago · briefing",
    );
    const share = detail?.find((d) => d.label === "share");
    expect(share).toEqual({ label: "share", value: "never", fired: false });
  });

  it("an unreadable config drops the ledger, never a row of nevers", () => {
    const row = wires({ ...ev, fired: null });
    expect(row?.detail).toBeUndefined();
    expect(row?.last).toBe("armed");
  });

  it("an empty ledger reads all never, the row staying plain armed", () => {
    const row = wires({ ...ev, fired: {} });
    expect(row?.last).toBe("armed");
    expect(row?.detail?.every((d) => !d.fired)).toBe(true);
  });

  it("a broken trio keeps its own headline — history is context, not cover", () => {
    const row = wires({ ...ev, vapid: "misconfigured" });
    expect(row?.last).toBe("push broken — see /system");
    expect(row?.detail?.length).toBe(6);
  });

  it("old firings switch to the week register", () => {
    const row = wires({ ...ev, fired: { chores: "2026-08-01" } });
    expect(row?.detail?.find((d) => d.label === "upkeep")?.value).toBe(
      "4w ago",
    );
    expect(row?.last).toBe("armed · spoke 4w ago");
  });
});
