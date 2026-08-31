import { describe, expect, it } from "vitest";
import {
  addApp,
  addEvent,
  closedCounts,
  daysSince,
  EMPTY_JOBS_CONFIG,
  filterApps,
  fitsJobsCap,
  funnel,
  isActive,
  lastEvent,
  MAX_APPS,
  normalizeJobsConfig,
  outcomeOf,
  removeApp,
  sectSearch,
  sortActive,
  sortClosed,
  type JobApp,
  type JobsConfig,
} from "./jobs";

/** One application in one line. */
const app = (
  id: string,
  company: string,
  events: { date: string; kind: string; note?: string }[],
  role = "engineer",
): JobApp =>
  ({
    id,
    company,
    role,
    events,
  }) as JobApp;

const cfg = (apps: JobApp[]): JobsConfig => ({ v: 1, apps });

describe("jobs — normalizeJobsConfig", () => {
  const doc = {
    v: 1,
    seq: 3,
    apps: [
      {
        id: "a1",
        company: "SNOOP",
        role: "junior software engineer",
        url: "https://example.com/jobs/1",
        events: [
          { date: "2026-08-20", kind: "applied", note: "via linkedin" },
          { date: "2026-08-25", kind: "screen" },
          { date: "2026-08-28", kind: "tech" },
        ],
      },
    ],
  };

  it("accepts a well-formed ledger unchanged, seq carried", () => {
    expect(normalizeJobsConfig(doc)).toEqual(doc);
  });

  it("accepts an empty role (a minimally logged mass application)", () => {
    const minimal = cfg([app("a1", "Acme", [], "")]);
    expect(normalizeJobsConfig(minimal)).toEqual(minimal);
  });

  it("drops unknown keys via the rebuild", () => {
    const out = normalizeJobsConfig({ ...doc, smuggled: true });
    expect(out).toEqual(doc);
  });

  it("rejects an unknown event kind — closed vocabulary", () => {
    expect(
      normalizeJobsConfig(
        cfg([app("a1", "Acme", [{ date: "2026-08-20", kind: "vibed" }])]),
      ),
    ).toBeNull();
  });

  it("rejects a non-http url, a bad date, duplicate ids", () => {
    expect(
      normalizeJobsConfig({
        v: 1,
        apps: [{ ...doc.apps[0], url: "javascript:alert(1)" }],
      }),
    ).toBeNull();
    expect(
      normalizeJobsConfig(
        cfg([app("a1", "Acme", [{ date: "aug 20", kind: "applied" }])]),
      ),
    ).toBeNull();
    expect(
      normalizeJobsConfig(cfg([app("a1", "Acme", []), app("a1", "Bcme", [])])),
    ).toBeNull();
  });

  it("rejects the wrong frame", () => {
    expect(normalizeJobsConfig(null)).toBeNull();
    expect(normalizeJobsConfig({ v: 2, apps: [] })).toBeNull();
    expect(normalizeJobsConfig({ v: 1, apps: "none" })).toBeNull();
  });
});

describe("jobs — reading the log", () => {
  const live = app("a1", "SNOOP", [
    { date: "2026-08-20", kind: "applied" },
    { date: "2026-08-28", kind: "tech" },
  ]);
  const dead = app("a2", "Acme", [
    { date: "2026-08-10", kind: "applied" },
    { date: "2026-08-22", kind: "rejected" },
  ]);

  it("lastEvent takes the latest date, ties to the later entry", () => {
    expect(lastEvent(live)?.kind).toBe("tech");
    const tied = app("a3", "Tie", [
      { date: "2026-08-20", kind: "applied" },
      { date: "2026-08-20", kind: "screen" },
    ]);
    expect(lastEvent(tied)?.kind).toBe("screen");
    expect(lastEvent(app("a4", "None", []))).toBeNull();
  });

  it("outcomeOf: terminal closes, a later non-terminal event re-opens", () => {
    expect(outcomeOf(live)).toBeNull();
    expect(outcomeOf(dead)).toBe("rejected");
    expect(isActive(dead)).toBe(false);
    const reopened = app("a5", "Back", [
      { date: "2026-08-10", kind: "ghosted" },
      { date: "2026-08-20", kind: "screen" },
    ]);
    expect(outcomeOf(reopened)).toBeNull();
  });

  it("daysSince counts whole days, never negative", () => {
    expect(daysSince("2026-08-28", "2026-09-01")).toBe(4);
    expect(daysSince("2026-09-01", "2026-09-01")).toBe(0);
    expect(daysSince("2026-09-05", "2026-09-01")).toBe(0);
  });

  it("sortActive is the chase list — oldest last event first", () => {
    const fresh = app("f", "Fresh", [{ date: "2026-08-30", kind: "applied" }]);
    const stale = app("s", "Stale", [{ date: "2026-08-16", kind: "applied" }]);
    expect(sortActive([fresh, live, stale, dead]).map((a) => a.id)).toEqual([
      "s",
      "a1",
      "f",
    ]);
  });

  it("sortClosed is newest verdict first", () => {
    const older = app("o", "Older", [{ date: "2026-07-01", kind: "ghosted" }]);
    expect(sortClosed([older, dead, live]).map((a) => a.id)).toEqual([
      "a2",
      "o",
    ]);
  });

  it("filterApps matches company or role, case-insensitive; blank passes all", () => {
    const apps = [live, app("a6", "Harbour", [], "data platform")];
    expect(filterApps(apps, "snoop")).toHaveLength(1);
    expect(filterApps(apps, "PLATFORM")).toHaveLength(1);
    expect(filterApps(apps, "  ")).toHaveLength(2);
    expect(filterApps(apps, "zzz")).toHaveLength(0);
  });
});

describe("jobs — funnel, closed counts, the sect line", () => {
  const apps = [
    app("a1", "A", [
      { date: "2026-08-01", kind: "applied" },
      { date: "2026-08-05", kind: "screen" },
      { date: "2026-08-09", kind: "tech" },
    ]),
    app("a2", "B", [{ date: "2026-08-02", kind: "applied" }]),
    app("a3", "C", [
      { date: "2026-08-03", kind: "applied" },
      { date: "2026-08-20", kind: "ghosted" },
    ]),
    app("a4", "D", [
      { date: "2026-08-04", kind: "applied" },
      { date: "2026-08-14", kind: "assessment" },
      { date: "2026-08-21", kind: "offer" },
      { date: "2026-08-25", kind: "rejected" },
    ]),
  ];

  it("funnel counts per application, not per event", () => {
    expect(funnel(apps)).toEqual({
      applied: 4,
      screened: 2,
      interviewed: 1,
      offers: 1,
    });
  });

  it("closedCounts buckets verdicts, omitting zero kinds", () => {
    expect(closedCounts(apps)).toEqual({ ghosted: 1, rejected: 1 });
  });

  it("sectSearch: underway / in trial / turned away", () => {
    expect(sectSearch(apps)).toEqual({
      underway: 2,
      inTrial: 1,
      turnedAway: 2,
    });
  });
});

describe("jobs — transforms", () => {
  it("addApp appends; refuses at the cap with null, never evicts", () => {
    const one = addApp(EMPTY_JOBS_CONFIG, app("a1", "Acme", []));
    expect(one?.apps).toHaveLength(1);
    const full = cfg(
      Array.from({ length: MAX_APPS }, (_, i) => app(`x${i}`, "Bulk", [])),
    );
    expect(addApp(full, app("y", "One More", []))).toBeNull();
  });

  it("addEvent logs onto the right app; unknown id no-ops", () => {
    const base = cfg([app("a1", "Acme", [])]);
    const next = addEvent(base, "a1", { date: "2026-09-01", kind: "screen" });
    expect(next.apps[0].events).toHaveLength(1);
    expect(
      addEvent(base, "nope", { date: "2026-09-01", kind: "screen" }),
    ).toEqual(base);
  });

  it("removeApp deletes exactly one row", () => {
    const base = cfg([app("a1", "Acme", []), app("a2", "Bcme", [])]);
    expect(removeApp(base, "a1").apps.map((a) => a.id)).toEqual(["a2"]);
  });

  it("seq is carried through every transform", () => {
    const base: JobsConfig = { v: 1, seq: 7, apps: [app("a1", "Acme", [])] };
    expect(
      addEvent(base, "a1", { date: "2026-09-01", kind: "screen" }).seq,
    ).toBe(7);
    expect(removeApp(base, "a1").seq).toBe(7);
    expect(addApp(base, app("a2", "B", []))?.seq).toBe(7);
  });

  it("a realistic hundred-app ledger fits the cap with room to spare", () => {
    const big = cfg(
      Array.from({ length: 100 }, (_, i) =>
        app(
          `id${i}`,
          `Company ${i} Pty Ltd`,
          [
            { date: "2026-08-01", kind: "applied", note: "via seek" },
            { date: "2026-08-20", kind: "ghosted" },
          ],
          "junior software engineer",
        ),
      ),
    );
    expect(fitsJobsCap(big)).toBe(true);
  });
});
