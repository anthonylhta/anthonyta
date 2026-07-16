import { describe, expect, it } from "vitest";
import {
  EMPTY_TRANSIT_CONFIG,
  anchorFromParts,
  delayMinutes,
  endpointParam,
  excludedClasses,
  fmtSydneyTime,
  groupNames,
  isDepArr,
  isModeFilter,
  isValidHm,
  nextDays,
  parseEndpointParam,
  pickJourneys,
  modeName,
  normalizeStopFinder,
  normalizeTransitConfig,
  normalizeTrip,
  removeTrip,
  stopFinderParams,
  sydneyDateTime,
  tripParams,
  tripTitle,
  upsertTrip,
  type TransitConfig,
  type TransitJourney,
  type TransitTrip,
} from "./transit";

const place = (over: Partial<TransitTrip["from"]> = {}) => ({
  kind: "stop" as const,
  value: "10101100",
  name: "Westmead Station",
  ...over,
});

const trip = (over: Partial<TransitTrip> = {}): TransitTrip => ({
  id: "t1",
  group: "work",
  label: "",
  from: place(),
  to: place({
    kind: "coord",
    value: "151.1932,-33.9312",
    name: "10 Bourke Rd, Mascot",
  }),
  modes: "train+bus",
  ...over,
});

// ---------------------------------------------------------------------------
// config shape
// ---------------------------------------------------------------------------

describe("normalizeTransitConfig", () => {
  it("round-trips a valid config", () => {
    const cfg: TransitConfig = { v: 1, trips: [trip()] };
    expect(normalizeTransitConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(
      cfg,
    );
  });

  it("accepts the empty config", () => {
    expect(normalizeTransitConfig({ v: 1, trips: [] })).toEqual(
      EMPTY_TRANSIT_CONFIG,
    );
  });

  it("rejects anything unrecognizable rather than degrading to empty", () => {
    expect(normalizeTransitConfig(null)).toBeNull();
    expect(normalizeTransitConfig({ v: 2, trips: [] })).toBeNull();
    expect(normalizeTransitConfig({ v: 1 })).toBeNull();
    expect(normalizeTransitConfig({ v: 1, trips: [{}] })).toBeNull();
    expect(
      normalizeTransitConfig({
        v: 1,
        trips: [trip({ modes: "boat" as never })],
      }),
    ).toBeNull();
    expect(
      normalizeTransitConfig({
        v: 1,
        trips: [trip({ from: place({ value: "" }) })],
      }),
    ).toBeNull();
  });

  it("caps the trip count", () => {
    const trips = Array.from({ length: 201 }, (_, i) => trip({ id: `t${i}` }));
    expect(normalizeTransitConfig({ v: 1, trips })).toBeNull();
  });
});

describe("config helpers", () => {
  it("groupNames dedupes in insertion order and skips empties", () => {
    const cfg: TransitConfig = {
      v: 1,
      trips: [
        trip({ id: "a", group: "work" }),
        trip({ id: "b", group: "school" }),
        trip({ id: "c", group: "work" }),
        trip({ id: "d", group: "" }),
      ],
    };
    expect(groupNames(cfg)).toEqual(["work", "school"]);
  });

  it("upsertTrip appends new ids and replaces existing ones", () => {
    const one = upsertTrip(EMPTY_TRANSIT_CONFIG, trip());
    expect(one.trips).toHaveLength(1);
    const replaced = upsertTrip(one, trip({ label: "renamed" }));
    expect(replaced.trips).toHaveLength(1);
    expect(replaced.trips[0].label).toBe("renamed");
  });

  it("removeTrip drops by id", () => {
    const cfg = upsertTrip(EMPTY_TRANSIT_CONFIG, trip());
    expect(removeTrip(cfg, "t1").trips).toHaveLength(0);
    expect(removeTrip(cfg, "nope").trips).toHaveLength(1);
  });

  it("tripTitle prefers the label, else derives from endpoints", () => {
    expect(tripTitle(trip({ label: "to work" }))).toBe("to work");
    expect(tripTitle(trip())).toBe("Westmead Station → 10 Bourke Rd, Mascot");
  });
});

describe("endpoint wire format", () => {
  it("round-trips stops and coords", () => {
    expect(parseEndpointParam(endpointParam(place()))).toEqual({
      kind: "stop",
      value: "10101100",
    });
    expect(parseEndpointParam("coord:151.1932,-33.9312")).toEqual({
      kind: "coord",
      value: "151.1932,-33.9312",
    });
  });

  it("rejects malformed input", () => {
    expect(parseEndpointParam(null)).toBeNull();
    expect(parseEndpointParam("")).toBeNull();
    expect(parseEndpointParam("stop:")).toBeNull();
    expect(parseEndpointParam("bogus:1")).toBeNull();
    expect(parseEndpointParam("coord:151.19")).toBeNull();
    expect(parseEndpointParam("coord:x,y")).toBeNull();
    expect(parseEndpointParam(`stop:${"9".repeat(300)}`)).toBeNull();
  });
});

describe("isModeFilter", () => {
  it("accepts the four filters, rejects the rest", () => {
    expect(isModeFilter("all")).toBe(true);
    expect(isModeFilter("train+bus")).toBe(true);
    expect(isModeFilter("boat")).toBe(false);
    expect(isModeFilter(1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// request params
// ---------------------------------------------------------------------------

describe("excludedClasses", () => {
  it("excludes nothing for all", () => {
    expect(excludedClasses("all")).toEqual([]);
  });

  it("train keeps heavy rail AND metro", () => {
    const excluded = excludedClasses("train");
    expect(excluded).not.toContain(1);
    expect(excluded).not.toContain(2);
    expect(excluded).toEqual(expect.arrayContaining([4, 5, 7, 9, 11]));
  });

  it("bus keeps only buses", () => {
    expect(excludedClasses("bus").sort((a, b) => a - b)).toEqual([
      1, 2, 4, 7, 9, 11,
    ]);
  });

  it("train+bus keeps rail, metro and buses", () => {
    expect(excludedClasses("train+bus").sort((a, b) => a - b)).toEqual([
      4, 7, 9, 11,
    ]);
  });
});

describe("sydneyDateTime", () => {
  it("renders the Sydney wall clock in winter (AEST, +10)", () => {
    const now = new Date(Date.UTC(2026, 6, 16, 22, 2)); // 08:02 on the 17th in Sydney
    expect(sydneyDateTime(now)).toEqual({ date: "20260717", time: "0802" });
  });

  it("renders the Sydney wall clock in summer (AEDT, +11)", () => {
    const now = new Date(Date.UTC(2026, 0, 15, 13, 30)); // 00:30 on the 16th in Sydney
    expect(sydneyDateTime(now)).toEqual({ date: "20260116", time: "0030" });
  });
});

describe("stopFinderParams", () => {
  it("asks for any-typed matches in rapidJSON", () => {
    const p = stopFinderParams("qantas");
    expect(p.get("name_sf")).toBe("qantas");
    expect(p.get("type_sf")).toBe("any");
    expect(p.get("outputFormat")).toBe("rapidJSON");
    expect(p.get("TfNSWSF")).toBe("true");
  });
});

describe("tripParams", () => {
  const now = new Date(Date.UTC(2026, 6, 16, 22, 2));

  it("sends stops by id and addresses as EPSG:4326 coords (lon:lat)", () => {
    const p = tripParams({
      from: { kind: "stop", value: "10101100" },
      to: { kind: "coord", value: "151.1932,-33.9312" },
      modes: "all",
      at: now,
    });
    expect(p.get("type_origin")).toBe("any");
    expect(p.get("name_origin")).toBe("10101100");
    expect(p.get("type_destination")).toBe("coord");
    expect(p.get("name_destination")).toBe("151.1932:-33.9312:EPSG:4326");
    expect(p.get("itdDate")).toBe("20260717");
    expect(p.get("itdTime")).toBe("0802");
    expect(p.get("depArrMacro")).toBe("dep");
  });

  it("omits mode exclusion entirely for all", () => {
    const p = tripParams({
      from: { kind: "stop", value: "1" },
      to: { kind: "stop", value: "2" },
      modes: "all",
      at: now,
    });
    expect(p.get("excludedMeans")).toBeNull();
    expect([...p.keys()].filter((k) => k.startsWith("exclMOT_"))).toEqual([]);
  });

  it("excludes the complement for train+bus", () => {
    const p = tripParams({
      from: { kind: "stop", value: "1" },
      to: { kind: "stop", value: "2" },
      modes: "train+bus",
      at: now,
    });
    expect(p.get("excludedMeans")).toBe("checkbox");
    expect(p.get("exclMOT_4")).toBe("1");
    expect(p.get("exclMOT_7")).toBe("1");
    expect(p.get("exclMOT_9")).toBe("1");
    expect(p.get("exclMOT_11")).toBe("1");
    expect(p.get("exclMOT_1")).toBeNull();
    expect(p.get("exclMOT_2")).toBeNull();
    expect(p.get("exclMOT_5")).toBeNull();
  });

  it("anchors on arrival for arr — same wire time, flipped macro", () => {
    const p = tripParams({
      from: { kind: "stop", value: "1" },
      to: { kind: "stop", value: "2" },
      modes: "all",
      depArr: "arr",
      at: new Date(Date.UTC(2026, 6, 16, 23, 0)), // 09:00 on the 17th in Sydney
    });
    expect(p.get("depArrMacro")).toBe("arr");
    expect(p.get("itdDate")).toBe("20260717");
    expect(p.get("itdTime")).toBe("0900");
  });
});

describe("isDepArr", () => {
  it("accepts the two anchors, rejects the rest", () => {
    expect(isDepArr("dep")).toBe(true);
    expect(isDepArr("arr")).toBe(true);
    expect(isDepArr("now")).toBe(false);
    expect(isDepArr(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stop-finder normalization
// ---------------------------------------------------------------------------

describe("normalizeStopFinder", () => {
  it("keeps stops by id and flips address coords to lon,lat", () => {
    const out = normalizeStopFinder({
      locations: [
        {
          id: "10101100",
          type: "stop",
          name: "Westmead, Westmead Station",
          disassembledName: "Westmead Station",
        },
        {
          id: "ephemeral:123",
          type: "singlehouse",
          name: "10 Bourke Rd, Mascot",
          coord: [-33.9312, 151.1932], // response order: [lat, lon]
        },
      ],
    });
    expect(out).toEqual([
      {
        kind: "stop",
        value: "10101100",
        name: "Westmead Station",
        sub: "Westmead, Westmead Station",
      },
      {
        kind: "coord",
        value: "151.1932,-33.9312",
        name: "10 Bourke Rd, Mascot",
        sub: null,
      },
    ]);
  });

  it("drops malformed entries and respects the limit", () => {
    const good = {
      id: "1",
      type: "stop",
      disassembledName: "A",
      name: "A",
    };
    const out = normalizeStopFinder(
      {
        locations: [
          null,
          {},
          { type: "poi", name: "no coord" },
          { type: "poi", name: "bad coord", coord: ["x", "y"] },
          ...Array.from({ length: 10 }, (_, i) => ({
            ...good,
            id: `${i}`,
            disassembledName: `A${i}`,
          })),
        ],
      },
      3,
    );
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.kind === "stop")).toBe(true);
  });

  it("returns empty on garbage", () => {
    expect(normalizeStopFinder(null)).toEqual([]);
    expect(normalizeStopFinder({ locations: "nope" })).toEqual([]);
  });

  it("ranks isBest/matchQuality above response order (the bike-locker case)", () => {
    // Live TfNSW data: two "Bike Lockers - Westmead Station" POIs arrive BEFORE
    // the station itself; only the station carries isBest.
    const out = normalizeStopFinder({
      locations: [
        {
          type: "poi",
          name: "Bike Lockers - Westmead Station, Alexandra Ave",
          coord: [-33.8, 150.98],
          matchQuality: 800,
        },
        {
          type: "poi",
          name: "Bike Lockers - Westmead Station, Railway Pde",
          coord: [-33.8, 150.98],
          matchQuality: 700,
        },
        {
          type: "stop",
          id: "214510",
          name: "Westmead, Westmead Station",
          disassembledName: "Westmead Station",
          isBest: true,
          matchQuality: 1000,
        },
      ],
    });
    expect(out[0]).toMatchObject({ kind: "stop", value: "214510" });
    expect(out[1].name).toContain("Alexandra Ave");
  });
});

// ---------------------------------------------------------------------------
// trip normalization
// ---------------------------------------------------------------------------

describe("delayMinutes", () => {
  it("whole minutes between planned and estimated", () => {
    expect(
      delayMinutes("2026-07-17T08:07:00+10:00", "2026-07-17T08:09:00+10:00"),
    ).toBe(2);
    expect(
      delayMinutes("2026-07-17T08:07:00+10:00", "2026-07-17T08:07:00+10:00"),
    ).toBe(0);
    expect(
      delayMinutes("2026-07-17T08:07:00+10:00", "2026-07-17T08:06:00+10:00"),
    ).toBe(-1);
  });

  it("null unless both timestamps parse", () => {
    expect(delayMinutes(null, "2026-07-17T08:09:00+10:00")).toBeNull();
    expect(delayMinutes("2026-07-17T08:07:00+10:00", null)).toBeNull();
    expect(delayMinutes("garbage", "2026-07-17T08:09:00+10:00")).toBeNull();
  });
});

/** A realistic slice of a TfNSW rapidJSON /trip response. */
const rawTrip = {
  journeys: [
    {
      legs: [
        {
          duration: 240,
          distance: 300,
          transportation: { product: { class: 100, name: "footpath" } },
          origin: {
            name: "Great Western Hwy, Westmead",
            departureTimePlanned: "2026-07-16T22:02:00Z",
          },
          destination: {
            name: "Westmead Station",
            arrivalTimePlanned: "2026-07-16T22:06:00Z",
          },
        },
        {
          duration: 1920,
          isRealtimeControlled: true,
          transportation: {
            number: "T1 North Shore & Western Line",
            disassembledName: "T1",
            product: { class: 1, name: "Train" },
            destination: { name: "City via Parramatta" },
          },
          origin: {
            name: "Westmead Station, Platform 1",
            disassembledName: "Westmead Station, Platform 1",
            departureTimePlanned: "2026-07-16T22:07:00Z",
            departureTimeEstimated: "2026-07-16T22:09:00Z",
          },
          destination: {
            name: "Central Station, Platform 16",
            disassembledName: "Central Station, Platform 16",
            arrivalTimePlanned: "2026-07-16T22:39:00Z",
            arrivalTimeEstimated: "2026-07-16T22:41:00Z",
          },
          stopSequence: [
            { name: "Westmead Station, Platform 1" },
            {
              disassembledName: "Parramatta Station, Platform 2",
              departureTimePlanned: "2026-07-16T22:12:00Z",
            },
            {
              disassembledName: "Strathfield Station, Platform 6",
              departureTimePlanned: "2026-07-16T22:30:00Z",
            },
            { name: "Central Station, Platform 16" },
          ],
          infos: [
            {
              id: "alert-1",
              priority: "high",
              subtitle: "Signal repairs at Green Square",
              url: "https://transportnsw.info/alerts/1",
            },
          ],
        },
        {
          duration: 540,
          distance: 650,
          transportation: { product: { class: 99, name: "walk" } },
          origin: {
            name: "Central Station",
            departureTimePlanned: "2026-07-16T22:41:00Z",
          },
          destination: {
            name: "10 Bourke Rd, Mascot",
            arrivalTimePlanned: "2026-07-16T22:50:00Z",
          },
        },
      ],
    },
    {
      legs: [
        {
          duration: 540,
          realtimeStatus: ["TRIP_CANCELLED"],
          transportation: {
            disassembledName: "T8",
            product: { class: 1, name: "Train" },
            destination: { name: "Macarthur" },
          },
          origin: {
            name: "Central Station",
            properties: { platform: "23" },
            departureTimePlanned: "2026-07-16T22:58:00Z",
          },
          destination: {
            name: "Mascot Station",
            arrivalTimePlanned: "2026-07-16T23:07:00Z",
          },
          infos: [
            {
              id: "alert-1",
              priority: "high",
              subtitle: "Signal repairs at Green Square",
            },
            {
              id: "alert-2",
              priority: "veryHigh",
              subtitle: "Buses replace trains on the T3",
            },
          ],
        },
      ],
    },
    "garbage journey",
  ],
};

describe("normalizeTrip", () => {
  const result = normalizeTrip(rawTrip);

  it("drops malformed journeys, keeps the rest", () => {
    expect(result.journeys).toHaveLength(2);
  });

  it("classifies walk legs (class 99/100) with distance, no line", () => {
    const [j] = result.journeys;
    expect(j.legs.map((l) => l.kind)).toEqual(["walk", "transit", "walk"]);
    expect(j.legs[0].distanceM).toBe(300);
    expect(j.legs[0].durationMin).toBe(4);
    expect(j.legs[0].line).toBeNull();
  });

  it("extracts line, headsign, platform and delay on transit legs", () => {
    const train = result.journeys[0].legs[1];
    expect(train.line).toBe("T1");
    expect(train.headsign).toBe("City via Parramatta");
    expect(train.from.name).toBe("Westmead Station");
    expect(train.from.platform).toBe("1");
    expect(train.to.platform).toBe("16");
    expect(train.live).toBe(true);
    expect(delayMinutes(train.from.timePlanned, train.from.timeEst)).toBe(2);
  });

  it("keeps intermediate stops only, platform-stripped", () => {
    const train = result.journeys[0].legs[1];
    expect(train.stops).toEqual([
      { name: "Parramatta Station", time: "2026-07-16T22:12:00Z" },
      { name: "Strathfield Station", time: "2026-07-16T22:30:00Z" },
    ]);
  });

  it("reads platform from properties when the name has none", () => {
    const t8 = result.journeys[1].legs[0];
    expect(t8.from.platform).toBe("23");
  });

  it("flags cancellation from realtimeStatus", () => {
    expect(result.journeys[0].cancelled).toBe(false);
    expect(result.journeys[1].legs[0].cancelled).toBe(true);
    expect(result.journeys[1].cancelled).toBe(true);
  });

  it("summarizes the journey: endpoints, duration, interchanges, delay", () => {
    const [j] = result.journeys;
    expect(j.departPlanned).toBe("2026-07-16T22:02:00Z");
    expect(j.arrivePlanned).toBe("2026-07-16T22:50:00Z");
    expect(j.durationMin).toBe(48);
    expect(j.interchanges).toBe(0);
    expect(j.delayMin).toBe(2);
    expect(j.live).toBe(true);
  });

  it("falls back to summed leg durations when endpoint times are missing", () => {
    const out = normalizeTrip({
      journeys: [
        {
          legs: [
            {
              duration: 600,
              transportation: { product: { class: 5 } },
              origin: { name: "A" },
              destination: { name: "B" },
            },
          ],
        },
      ],
    });
    expect(out.journeys[0].durationMin).toBe(10);
  });

  it("dedupes alerts across legs and sorts by priority", () => {
    expect(result.alerts.map((a) => a.id)).toEqual(["alert-2", "alert-1"]);
    expect(result.alerts[1].url).toBe("https://transportnsw.info/alerts/1");
  });

  it("returns empty on garbage", () => {
    expect(normalizeTrip(null)).toEqual({ journeys: [], alerts: [] });
    expect(normalizeTrip({ journeys: "no" })).toEqual({
      journeys: [],
      alerts: [],
    });
  });
});

// ---------------------------------------------------------------------------
// journey selection
// ---------------------------------------------------------------------------

/** Minimal journey with a given route shape + duration. */
function journey(
  lines: string[],
  durationMin: number,
  cancelled = false,
): TransitJourney {
  return {
    legs: lines.map((line) => ({
      kind: "transit" as const,
      modeClass: 1,
      line,
      headsign: null,
      durationMin: null,
      distanceM: null,
      from: { name: "A", platform: null, timePlanned: null, timeEst: null },
      to: { name: "B", platform: null, timePlanned: null, timeEst: null },
      stops: [],
      live: false,
      cancelled: false,
    })),
    interchanges: Math.max(0, lines.length - 1),
    durationMin,
    departPlanned: null,
    departEst: null,
    arrivePlanned: null,
    arriveEst: null,
    cancelled,
    live: false,
    delayMin: null,
  };
}

describe("pickJourneys", () => {
  it("passes short lists through untouched", () => {
    const two = [journey(["T1"], 30), journey(["T1"], 35)];
    expect(pickJourneys(two)).toEqual(two);
    expect(pickJourneys([])).toEqual([]);
  });

  it("collapses near-identical departures to the primary alone", () => {
    const js = [
      journey(["T1", "T8"], 60),
      journey(["T1", "T8"], 62),
      journey(["T1", "T8"], 65),
    ];
    expect(pickJourneys(js)).toEqual([js[0]]);
  });

  it("keeps a different route at comparable cost", () => {
    const js = [
      journey(["T1", "T8"], 60),
      journey(["T1", "T8"], 62),
      journey(["T1", "305"], 68),
    ];
    expect(pickJourneys(js)).toEqual([js[0], js[2]]);
  });

  it("drops a different route that costs too much more", () => {
    const js = [
      journey(["T1", "T8"], 60),
      journey(["T1", "305"], 85),
      journey(["T1", "T8"], 62),
    ];
    expect(pickJourneys(js)).toEqual([js[0]]);
  });

  it("keeps a faster journey even on the same route", () => {
    const js = [
      journey(["T1", "T8"], 60),
      journey(["T1", "T8"], 61),
      journey(["T1", "T8"], 52),
    ];
    expect(pickJourneys(js)).toEqual([js[0], js[2]]);
  });

  it("shows a cancelled first service beside the first live alternative", () => {
    const js = [
      journey(["T1", "T8"], 60, true),
      journey(["T1", "T8"], 62),
      journey(["T1", "T8"], 65),
    ];
    expect(pickJourneys(js)).toEqual([js[0], js[1]]);
  });
});

// ---------------------------------------------------------------------------
// time-anchor parts
// ---------------------------------------------------------------------------

describe("anchorFromParts", () => {
  it("builds a local-clock Date from valid parts", () => {
    const d = anchorFromParts("2026-07-18", "09:05");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(6);
    expect(d!.getDate()).toBe(18);
    expect(d!.getHours()).toBe(9);
    expect(d!.getMinutes()).toBe(5);
  });

  it("rejects malformed parts", () => {
    expect(anchorFromParts("2026-7-18", "09:05")).toBeNull();
    expect(anchorFromParts("2026-07-18", "9:05")).toBeNull();
    expect(anchorFromParts("2026-07-18", "24:00")).toBeNull();
    expect(anchorFromParts("2026-07-18", "09:60")).toBeNull();
    expect(anchorFromParts("", "")).toBeNull();
  });
});

describe("isValidHm", () => {
  it("accepts 24h HH:MM only", () => {
    expect(isValidHm("00:00")).toBe(true);
    expect(isValidHm("23:59")).toBe(true);
    expect(isValidHm("24:00")).toBe(false);
    expect(isValidHm("9:00")).toBe(false);
  });
});

describe("nextDays", () => {
  it("labels today/tomorrow then weekday, crossing month edges", () => {
    const days = nextDays(4, new Date(2026, 6, 30, 15, 0)); // Thu 30 Jul local
    expect(days.map((d) => d.ymd)).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
    expect(days[0].label).toBe("today");
    expect(days[1].label).toBe("tomorrow");
    expect(days[2].label).toBe("sat 01/08");
    expect(days[3].label).toBe("sun 02/08");
  });
});

// ---------------------------------------------------------------------------
// display helpers
// ---------------------------------------------------------------------------

describe("fmtSydneyTime", () => {
  it("renders the Sydney wall clock", () => {
    expect(fmtSydneyTime("2026-07-16T22:07:00Z")).toBe("08:07");
    expect(fmtSydneyTime("2026-07-17T08:07:00+10:00")).toBe("08:07");
  });

  it("em-dash on missing/garbage", () => {
    expect(fmtSydneyTime(null)).toBe("—");
    expect(fmtSydneyTime("not a date")).toBe("—");
  });
});

describe("modeName", () => {
  it("names the classes the UI badges", () => {
    expect(modeName(1)).toBe("train");
    expect(modeName(2)).toBe("metro");
    expect(modeName(5)).toBe("bus");
    expect(modeName(9)).toBe("ferry");
    expect(modeName(null)).toBe("transit");
    expect(modeName(42)).toBe("transit");
  });
});
