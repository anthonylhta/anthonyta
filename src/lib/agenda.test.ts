import { describe, expect, it } from "vitest";
import {
  AGENDA_MAX_BYTES,
  EMPTY_AGENDA_CONFIG,
  MAX_EVENTS,
  addEvent,
  agendaPayloadBytes,
  dayLabel,
  fitsAgendaCap,
  normalizeAgendaConfig,
  parseTimeInput,
  pruneCutoff,
  pruneEvents,
  removeEvent,
  timeLabel,
  upcoming,
  type AgendaConfig,
  type AgendaEvent,
} from "./agenda";

const event = (over: Partial<AgendaEvent> = {}): AgendaEvent => ({
  id: "e1",
  date: "2026-07-20",
  start: "15:00",
  end: "23:00",
  title: "work",
  ...over,
});

/** A schedule with one shift on it, the shape most tests start from. */
const base = (over: Partial<AgendaConfig> = {}): AgendaConfig => ({
  v: 1,
  events: [event()],
  ...over,
});

describe("normalizeAgendaConfig", () => {
  it("round-trips a valid config", () => {
    const cfg = base();
    expect(normalizeAgendaConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
  });

  it("accepts the empty config", () => {
    expect(normalizeAgendaConfig({ v: 1, events: [] })).toEqual(
      EMPTY_AGENDA_CONFIG,
    );
  });

  it("accepts a date-only event and a start with no end", () => {
    expect(
      normalizeAgendaConfig(
        base({ events: [event({ start: undefined, end: undefined })] }),
      ),
    ).not.toBeNull();
    expect(
      normalizeAgendaConfig(base({ events: [event({ end: undefined })] })),
    ).not.toBeNull();
  });

  it("carries seq through the rebuild and rejects an invalid one (58b)", () => {
    expect(normalizeAgendaConfig({ ...EMPTY_AGENDA_CONFIG, seq: 4 })).toEqual({
      ...EMPTY_AGENDA_CONFIG,
      seq: 4,
    });
    expect(
      normalizeAgendaConfig({ ...EMPTY_AGENDA_CONFIG, seq: -1 }),
    ).toBeNull();
    expect(
      normalizeAgendaConfig({ ...EMPTY_AGENDA_CONFIG, seq: 2.5 }),
    ).toBeNull();
  });

  it("rejects anything unrecognizable rather than degrading to empty", () => {
    expect(normalizeAgendaConfig(null)).toBeNull();
    expect(normalizeAgendaConfig("nope")).toBeNull();
    expect(normalizeAgendaConfig({ ...EMPTY_AGENDA_CONFIG, v: 2 })).toBeNull();
    expect(normalizeAgendaConfig({ v: 1 })).toBeNull();
    expect(
      normalizeAgendaConfig({ ...EMPTY_AGENDA_CONFIG, events: [{}] }),
    ).toBeNull();
  });

  it("rejects a malformed event", () => {
    expect(
      normalizeAgendaConfig(base({ events: [event({ title: "" })] })),
    ).toBeNull();
    expect(
      normalizeAgendaConfig(base({ events: [event({ id: "" })] })),
    ).toBeNull();
    expect(
      normalizeAgendaConfig(base({ events: [event({ date: "20/07/2026" })] })),
    ).toBeNull();
    expect(
      normalizeAgendaConfig(
        base({ events: [event({ title: "x".repeat(81) })] }),
      ),
    ).toBeNull();
  });

  it("rejects a malformed time — shape and range both", () => {
    for (const start of ["7:00", "1500", "24:00", "15:60", "15:0", ""])
      expect(
        normalizeAgendaConfig(base({ events: [event({ start })] })),
        start,
      ).toBeNull();
  });

  it("rejects an end with no start — half a range says nothing", () => {
    expect(
      normalizeAgendaConfig(
        base({ events: [event({ start: undefined, end: "23:00" })] }),
      ),
    ).toBeNull();
  });

  it("rejects a config over the event cap", () => {
    const events = Array.from({ length: MAX_EVENTS + 1 }, (_, i) =>
      event({ id: `e${i}` }),
    );
    expect(normalizeAgendaConfig(base({ events }))).toBeNull();
  });
});

describe("addEvent", () => {
  it("appends, trimming the title", () => {
    const cfg = addEvent(base(), event({ id: "e2", title: "  ortho  " }));
    expect(cfg.events.map((e) => e.title)).toEqual(["work", "ortho"]);
  });

  it("refuses an empty title", () => {
    expect(addEvent(EMPTY_AGENDA_CONFIG, event({ title: "   " }))).toBe(
      EMPTY_AGENDA_CONFIG,
    );
  });

  it("is idempotent on id, so the 409 dance can re-run it", () => {
    const fresh = addEvent(base(), event({ id: "e2" }));
    expect(addEvent(fresh, event({ id: "e2" }))).toBe(fresh);
  });

  it("appends regardless of the date — upcoming does the ordering", () => {
    const cfg = addEvent(base(), event({ id: "e0", date: "2026-07-01" }));
    expect(cfg.events.map((e) => e.id)).toEqual(["e1", "e0"]);
  });

  it("refuses past the event cap rather than evicting a future date", () => {
    const events = Array.from({ length: MAX_EVENTS }, (_, i) =>
      event({ id: `e${i}` }),
    );
    const full = base({ events });
    expect(addEvent(full, event({ id: "new" }))).toBe(full);
  });

  it("carries seq through untouched (the writer bumps it, not the transform)", () => {
    expect(addEvent(base({ seq: 7 }), event({ id: "e2" })).seq).toBe(7);
  });
});

describe("removeEvent", () => {
  it("removes by id and keeps the remaining order", () => {
    const cfg = addEvent(base(), event({ id: "e2" }));
    expect(removeEvent(cfg, "e1").events.map((e) => e.id)).toEqual(["e2"]);
  });

  it("is a no-op identity on an unknown id, so the 409 dance can re-run it", () => {
    const cfg = base();
    expect(removeEvent(cfg, "nope")).toBe(cfg);
  });

  it("carries seq through untouched", () => {
    expect(removeEvent(base({ seq: 7 }), "e1").seq).toBe(7);
  });
});

describe("pruneEvents", () => {
  const cfg = base({
    events: [
      event({ id: "old", date: "2026-07-10" }),
      event({ id: "edge", date: "2026-07-20" }),
      event({ id: "new", date: "2026-07-30" }),
    ],
  });

  it("drops everything strictly before the cutoff, keeping the boundary day", () => {
    expect(pruneEvents(cfg, "2026-07-20").events.map((e) => e.id)).toEqual([
      "edge",
      "new",
    ]);
  });

  it("is a no-op identity when there is nothing to drop", () => {
    expect(pruneEvents(cfg, "2026-07-10")).toBe(cfg);
    expect(pruneEvents(EMPTY_AGENDA_CONFIG, "2026-07-20")).toBe(
      EMPTY_AGENDA_CONFIG,
    );
  });

  it("re-running the same prune changes nothing further", () => {
    const once = pruneEvents(cfg, "2026-07-20");
    expect(pruneEvents(once, "2026-07-20")).toBe(once);
  });

  it("carries seq through untouched", () => {
    expect(pruneEvents(base({ ...cfg, seq: 7 }), "2026-07-20").seq).toBe(7);
  });

  it("cuts off a week behind today, month boundary included", () => {
    expect(pruneCutoff("2026-07-20")).toBe("2026-07-13");
    expect(pruneCutoff("2026-08-02")).toBe("2026-07-26");
    expect(pruneCutoff("2027-01-01")).toBe("2026-12-25");
  });

  it("keeps the cutoff day itself — a week of grace, then gone", () => {
    const today = "2026-07-20";
    const week = base({
      events: [
        event({ id: "kept", date: pruneCutoff(today) }),
        event({ id: "gone", date: "2026-07-12" }),
      ],
    });
    expect(
      pruneEvents(week, pruneCutoff(today)).events.map((e) => e.id),
    ).toEqual(["kept"]);
  });
});

describe("upcoming", () => {
  const cfg = base({
    events: [
      event({ id: "past", date: "2026-07-19" }),
      event({ id: "today", date: "2026-07-20" }),
      event({ id: "soon", date: "2026-07-26" }),
      event({ id: "far", date: "2026-08-20" }),
    ],
  });

  it("windows from today to the horizon, dropping the past and the far side", () => {
    expect(upcoming(cfg, "2026-07-20").map((e) => e.id)).toEqual([
      "today",
      "soon",
    ]);
  });

  it("includes both window edges", () => {
    const edges = base({
      events: [
        event({ id: "first", date: "2026-07-20" }),
        event({ id: "last", date: "2026-08-03" }),
        event({ id: "over", date: "2026-08-04" }),
      ],
    });
    expect(upcoming(edges, "2026-07-20").map((e) => e.id)).toEqual([
      "first",
      "last",
    ]);
  });

  it("honours a custom horizon", () => {
    expect(upcoming(cfg, "2026-07-20", 3).map((e) => e.id)).toEqual(["today"]);
    expect(upcoming(cfg, "2026-07-20", 40).map((e) => e.id)).toEqual([
      "today",
      "soon",
      "far",
    ]);
  });

  it("crosses a month boundary in the horizon", () => {
    const across = base({
      events: [event({ id: "aug", date: "2026-08-02" })],
    });
    expect(upcoming(across, "2026-07-31").map((e) => e.id)).toEqual(["aug"]);
  });

  it("sorts by day, then all-day first, then start, then title", () => {
    const mixed = base({
      events: [
        event({ id: "d2", date: "2026-07-21", start: "09:00", end: undefined }),
        event({ id: "c", date: "2026-07-20", start: "15:00", end: undefined }),
        event({
          id: "b",
          date: "2026-07-20",
          start: undefined,
          end: undefined,
          title: "zzz all day",
        }),
        event({ id: "a", date: "2026-07-20", start: "09:00", end: undefined }),
      ],
    });
    expect(upcoming(mixed, "2026-07-20").map((e) => e.id)).toEqual([
      "b",
      "a",
      "c",
      "d2",
    ]);
  });

  it("breaks a same-minute tie on title, so renders don't swap rows", () => {
    const tied = base({
      events: [
        event({ id: "z", title: "zeta", start: "09:00", end: undefined }),
        event({ id: "a", title: "alpha", start: "09:00", end: undefined }),
      ],
    });
    expect(upcoming(tied, "2026-07-20").map((e) => e.title)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("does not reorder the stored config", () => {
    const stored = base({
      events: [
        event({ id: "later", date: "2026-07-25" }),
        event({ id: "sooner", date: "2026-07-20" }),
      ],
    });
    upcoming(stored, "2026-07-20");
    expect(stored.events.map((e) => e.id)).toEqual(["later", "sooner"]);
  });

  it("is empty when nothing is ahead", () => {
    expect(upcoming(EMPTY_AGENDA_CONFIG, "2026-07-20")).toEqual([]);
  });
});

describe("dayLabel", () => {
  it("names today and tomorrow", () => {
    expect(dayLabel("2026-07-20", "2026-07-20")).toBe("today");
    expect(dayLabel("2026-07-21", "2026-07-20")).toBe("tmr");
  });

  it("falls back to the weekday", () => {
    expect(dayLabel("2026-07-22", "2026-07-20")).toBe("wed");
    expect(dayLabel("2026-07-26", "2026-07-20")).toBe("sun");
  });

  it("reads tomorrow across a month boundary", () => {
    expect(dayLabel("2026-08-01", "2026-07-31")).toBe("tmr");
    expect(dayLabel("2026-08-02", "2026-07-31")).toBe("sun");
  });

  it("reads tomorrow across a year boundary", () => {
    expect(dayLabel("2027-01-01", "2026-12-31")).toBe("tmr");
  });
});

describe("timeLabel", () => {
  it("renders a range, a start, or nothing", () => {
    expect(timeLabel(event())).toBe("15:00–23:00");
    expect(timeLabel(event({ end: undefined }))).toBe("15:00");
    expect(timeLabel(event({ start: undefined, end: undefined }))).toBe("");
  });
});

describe("parseTimeInput", () => {
  it("parses and zero-pads the hour", () => {
    expect(parseTimeInput("7:05")).toBe("07:05");
    expect(parseTimeInput("15:00")).toBe("15:00");
    expect(parseTimeInput("00:00")).toBe("00:00");
    expect(parseTimeInput("23:59")).toBe("23:59");
  });

  it("is null on an empty field — the caller reads that as no time", () => {
    expect(parseTimeInput("")).toBeNull();
  });

  it("rejects a half-typed or malformed field", () => {
    expect(parseTimeInput("7:5")).toBeNull();
    expect(parseTimeInput("15:")).toBeNull();
    expect(parseTimeInput("1500")).toBeNull();
    expect(parseTimeInput("15.00")).toBeNull();
    expect(parseTimeInput("3pm")).toBeNull();
    expect(parseTimeInput(" 15:00")).toBeNull();
  });

  it("rejects an out-of-range hour or minute", () => {
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("15:60")).toBeNull();
    expect(parseTimeInput("99:99")).toBeNull();
  });
});

describe("agendaPayloadBytes / fitsAgendaCap", () => {
  it("measures the JSON as UTF-8 bytes", () => {
    expect(agendaPayloadBytes(EMPTY_AGENDA_CONFIG)).toBe(
      JSON.stringify(EMPTY_AGENDA_CONFIG).length,
    );
  });

  it("accepts a real schedule and refuses one past the cap", () => {
    expect(fitsAgendaCap(base())).toBe(true);
    const huge = base({
      events: [event({ title: "x".repeat(AGENDA_MAX_BYTES) })],
    });
    expect(fitsAgendaCap(huge)).toBe(false);
  });

  it("fits a schedule filled to the event cap — the count binds first", () => {
    const full = base({
      events: Array.from({ length: MAX_EVENTS }, (_, i) =>
        event({ id: `e${i}`, title: "x".repeat(80) }),
      ),
    });
    expect(agendaPayloadBytes(full)).toBeLessThan(AGENDA_MAX_BYTES);
    expect(fitsAgendaCap(full)).toBe(true);
  });
});
