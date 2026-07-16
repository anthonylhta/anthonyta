/**
 * transit — the pure spine of the /transit page (owner-only door-to-door
 * journey planning on the TfNSW Trip Planner API).
 *
 * Everything here is side-effect free and unit-tested: the saved-trips config
 * shape (sealed client-side into the `meta/transit` envelope — the server never
 * sees an address in plaintext at rest), the TfNSW request-param builders, and
 * the defensive normalizers that turn the EFA rapidJSON responses into the
 * small shapes the UI renders. Network + env live in
 * `connectors/transit.ts`; route gating lives under `app/api/transit/`.
 *
 * Two conventions worth naming:
 *   - Coordinates are stored as `"lon,lat"` strings (x,y — the order EFA's
 *     `name_origin=LON:LAT:EPSG:4326` wants), while TfNSW *responses* deliver
 *     `coord: [lat, lon]`. `normalizeStopFinder` does the flip exactly once.
 *   - Times stay the ISO strings TfNSW returns; only `fmtSydneyTime` turns
 *     them into wall-clock text, always in Australia/Sydney.
 */

// ---------------------------------------------------------------------------
// saved-trips config — the E2EE envelope payload (server never parses this)
// ---------------------------------------------------------------------------

/** Envelope frame cap for the config PUT — generous for a few hundred trips. */
export const TRANSIT_MAX_BYTES = 65536;

export type PlaceKind = "stop" | "coord";

/** A resolved endpoint, snapshotted into the trip when it's saved (no separate
 *  place registry to keep referentially intact). */
export interface TransitPlace {
  kind: PlaceKind;
  /** Stop id for `kind: "stop"`; `"lon,lat"` for `kind: "coord"`. */
  value: string;
  /** Resolved display name ("Westmead Station", "10 Bourke Rd, Mascot"). */
  name: string;
}

export type ModeFilter = "all" | "train" | "bus" | "train+bus";

export interface TransitTrip {
  id: string;
  group: string;
  /** Owner label ("westmead maccas → qantas hq" when empty: derived). */
  label: string;
  from: TransitPlace;
  to: TransitPlace;
  modes: ModeFilter;
}

export interface TransitConfig {
  v: 1;
  trips: TransitTrip[];
}

export const EMPTY_TRANSIT_CONFIG: TransitConfig = { v: 1, trips: [] };

const MODE_FILTERS: ModeFilter[] = ["all", "train", "bus", "train+bus"];
const MAX_TRIPS = 200;
const MAX_STR = 200;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isShortStr(x: unknown): x is string {
  return typeof x === "string" && x.length <= MAX_STR;
}

function isPlace(x: unknown): x is TransitPlace {
  return (
    isObj(x) &&
    (x.kind === "stop" || x.kind === "coord") &&
    isShortStr(x.value) &&
    x.value.length > 0 &&
    isShortStr(x.name)
  );
}

function isTrip(x: unknown): x is TransitTrip {
  return (
    isObj(x) &&
    isShortStr(x.id) &&
    x.id.length > 0 &&
    isShortStr(x.group) &&
    isShortStr(x.label) &&
    isPlace(x.from) &&
    isPlace(x.to) &&
    MODE_FILTERS.includes(x.modes as ModeFilter)
  );
}

/** Strict parse of a decrypted config — null on anything unrecognizable, so a
 *  tampered/corrupt payload reads as "cannot decrypt", never as an empty
 *  (re-seedable) trip list. */
export function normalizeTransitConfig(x: unknown): TransitConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!Array.isArray(x.trips) || x.trips.length > MAX_TRIPS) return null;
  if (!x.trips.every(isTrip)) return null;
  return { v: 1, trips: x.trips };
}

/** Insertion-ordered unique group names — the tab row. */
export function groupNames(cfg: TransitConfig): string[] {
  const seen = new Set<string>();
  for (const t of cfg.trips) if (t.group) seen.add(t.group);
  return [...seen];
}

export function upsertTrip(
  cfg: TransitConfig,
  trip: TransitTrip,
): TransitConfig {
  const trips = cfg.trips.some((t) => t.id === trip.id)
    ? cfg.trips.map((t) => (t.id === trip.id ? trip : t))
    : [...cfg.trips, trip];
  return { v: 1, trips };
}

export function removeTrip(cfg: TransitConfig, id: string): TransitConfig {
  return { v: 1, trips: cfg.trips.filter((t) => t.id !== id) };
}

/** The card title: explicit label, else "from → to". */
export function tripTitle(trip: TransitTrip): string {
  return trip.label || `${trip.from.name} → ${trip.to.name}`;
}

export function isModeFilter(x: unknown): x is ModeFilter {
  return typeof x === "string" && MODE_FILTERS.includes(x as ModeFilter);
}

/** Wire format for an endpoint riding a query string: `stop:<id>` or
 *  `coord:<lon>,<lat>`. Null on anything else — the route answers 400. */
export function parseEndpointParam(
  s: string | null,
): Pick<TransitPlace, "kind" | "value"> | null {
  if (!s || s.length > MAX_STR + 6) return null;
  const idx = s.indexOf(":");
  if (idx < 1) return null;
  const kind = s.slice(0, idx);
  const value = s.slice(idx + 1);
  if (!value) return null;
  if (kind === "stop") return { kind: "stop", value };
  if (kind === "coord") {
    const parts = value.split(",");
    if (parts.length !== 2) return null;
    const [lon, lat] = parts.map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { kind: "coord", value };
  }
  return null;
}

export function endpointParam(p: Pick<TransitPlace, "kind" | "value">): string {
  return `${p.kind}:${p.value}`;
}

// ---------------------------------------------------------------------------
// TfNSW request params (EFA rapidJSON dialect)
// ---------------------------------------------------------------------------

/** TfNSW product classes (the manual's MOT table). */
export const MODE_CLASSES = {
  train: 1,
  metro: 2,
  lightrail: 4,
  bus: 5,
  coach: 7,
  ferry: 9,
  schoolbus: 11,
} as const;

const ALL_CLASSES = Object.values(MODE_CLASSES) as number[];

/** Classes a filter keeps. "train" deliberately includes metro — nobody saving
 *  a "train" trip wants Sydney Metro excluded from it. */
function includedClasses(modes: ModeFilter): number[] {
  switch (modes) {
    case "train":
      return [MODE_CLASSES.train, MODE_CLASSES.metro];
    case "bus":
      return [MODE_CLASSES.bus];
    case "train+bus":
      return [MODE_CLASSES.train, MODE_CLASSES.metro, MODE_CLASSES.bus];
    case "all":
      return ALL_CLASSES;
  }
}

/** The `exclMOT_<n>` set for a filter — the complement of what it keeps. */
export function excludedClasses(modes: ModeFilter): number[] {
  const keep = new Set(includedClasses(modes));
  return ALL_CLASSES.filter((c) => !keep.has(c));
}

const SYDNEY_DT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `now` as the Sydney wall clock, in the `itdDate`/`itdTime` wire format. */
export function sydneyDateTime(now: Date = new Date()): {
  date: string; // YYYYMMDD
  time: string; // HHMM
} {
  const parts: Record<string, string> = {};
  for (const p of SYDNEY_DT.formatToParts(now)) parts[p.type] = p.value;
  // Intl may render midnight as "24" with hourCycle quirks; normalize.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    time: `${hour}${parts.minute}`,
  };
}

/** `type_*` / `name_*` pair for one endpoint. Stops travel by global id;
 *  everything else travels as a coordinate (address ids are not stable). */
function endpointParams(
  side: "origin" | "destination",
  place: Pick<TransitPlace, "kind" | "value">,
): [string, string][] {
  if (place.kind === "stop") {
    return [
      [`type_${side}`, "any"],
      [`name_${side}`, place.value],
    ];
  }
  const [lon, lat] = place.value.split(",");
  return [
    [`type_${side}`, "coord"],
    [`name_${side}`, `${lon}:${lat}:EPSG:4326`],
  ];
}

/** Query for `/v1/tp/stop_finder` — free-text places, stops and addresses. */
export function stopFinderParams(q: string): URLSearchParams {
  return new URLSearchParams([
    ["outputFormat", "rapidJSON"],
    ["coordOutputFormat", "EPSG:4326"],
    ["type_sf", "any"],
    ["name_sf", q],
    ["TfNSWSF", "true"],
    ["version", "10.2.1.42"],
  ]);
}

/** Query for `/v1/tp/trip` — door-to-door journeys, real-time, mode-filtered. */
export function tripParams(opts: {
  from: Pick<TransitPlace, "kind" | "value">;
  to: Pick<TransitPlace, "kind" | "value">;
  modes: ModeFilter;
  now?: Date;
}): URLSearchParams {
  const { date, time } = sydneyDateTime(opts.now);
  const params = new URLSearchParams([
    ["outputFormat", "rapidJSON"],
    ["coordOutputFormat", "EPSG:4326"],
    ["depArrMacro", "dep"],
    ["itdDate", date],
    ["itdTime", time],
    ...endpointParams("origin", opts.from),
    ...endpointParams("destination", opts.to),
    ["calcNumberOfTrips", "4"],
    ["TfNSWTR", "true"],
    ["version", "10.2.1.42"],
  ]);
  const excluded = excludedClasses(opts.modes);
  if (excluded.length > 0) {
    params.set("excludedMeans", "checkbox");
    for (const c of excluded) params.set(`exclMOT_${c}`, "1");
  }
  return params;
}

// ---------------------------------------------------------------------------
// stop-finder response → place candidates
// ---------------------------------------------------------------------------

export interface PlaceCandidate extends TransitPlace {
  /** Locality line under the name ("Mascot, Sydney"), when it adds anything. */
  sub: string | null;
}

/** `coord: [lat, lon]` (response order) → the stored `"lon,lat"`. */
function coordValue(coord: unknown): string | null {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const [lat, lon] = coord;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `${lon},${lat}`;
}

/** Best-effort normalize of a stop_finder response; anything malformed is
 *  simply dropped — a degraded autocomplete beats a crashed one. */
export function normalizeStopFinder(
  json: unknown,
  limit = 8,
): PlaceCandidate[] {
  if (!isObj(json) || !Array.isArray(json.locations)) return [];
  const out: PlaceCandidate[] = [];
  for (const loc of json.locations) {
    if (out.length >= limit) break;
    if (!isObj(loc)) continue;
    const short =
      typeof loc.disassembledName === "string" ? loc.disassembledName : null;
    const full = typeof loc.name === "string" ? loc.name : null;
    const name = short ?? full;
    if (!name) continue;

    if (loc.type === "stop" && typeof loc.id === "string" && loc.id) {
      out.push({
        kind: "stop",
        value: loc.id,
        name,
        sub: full && full !== name ? full : null,
      });
      continue;
    }
    const value = coordValue(loc.coord);
    if (!value) continue;
    out.push({
      kind: "coord",
      value,
      name,
      sub: full && full !== name ? full : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// trip response → journeys the UI can render
// ---------------------------------------------------------------------------

export interface LegPoint {
  name: string;
  platform: string | null;
  timePlanned: string | null;
  timeEst: string | null;
}

export interface LegStop {
  name: string;
  time: string | null;
}

export interface TransitLeg {
  kind: "walk" | "transit";
  /** TfNSW product class (transit legs only). */
  modeClass: number | null;
  /** Short line id — "T1", "305", "M1". */
  line: string | null;
  /** Where the service is headed ("Macarthur"). */
  headsign: string | null;
  durationMin: number | null;
  distanceM: number | null;
  from: LegPoint;
  to: LegPoint;
  /** Intermediate stops only (endpoints already ride in from/to). */
  stops: LegStop[];
  live: boolean;
  cancelled: boolean;
}

export interface TransitJourney {
  legs: TransitLeg[];
  interchanges: number;
  durationMin: number | null;
  departPlanned: string | null;
  departEst: string | null;
  arrivePlanned: string | null;
  arriveEst: string | null;
  /** Any transit leg cancelled. */
  cancelled: boolean;
  /** Any transit leg under live monitoring. */
  live: boolean;
  /** Departure delay of the first transit leg, minutes (0 = on time). */
  delayMin: number | null;
}

export interface TransitAlert {
  id: string;
  priority: string | null;
  title: string;
  url: string | null;
}

export interface TripResult {
  journeys: TransitJourney[];
  alerts: TransitAlert[];
}

/** Whole minutes between planned and estimated; null unless both parse. */
export function delayMinutes(
  planned: string | null,
  est: string | null,
): number | null {
  if (!planned || !est) return null;
  const p = Date.parse(planned);
  const e = Date.parse(est);
  if (Number.isNaN(p) || Number.isNaN(e)) return null;
  return Math.round((e - p) / 60000);
}

const WALK_CLASSES = new Set([99, 100]);

/** "Central Station, Platform 16" → ["Central Station", "16"]. */
function splitPlatform(name: string): [string, string | null] {
  const m = /^(.*?),\s*Platform\s+(\S+)$/i.exec(name);
  return m ? [m[1], m[2]] : [name, null];
}

function str(x: unknown): string | null {
  return typeof x === "string" && x ? x : null;
}

function legPoint(x: unknown, side: "departure" | "arrival"): LegPoint {
  if (!isObj(x))
    return { name: "?", platform: null, timePlanned: null, timeEst: null };
  const rawName = str(x.disassembledName) ?? str(x.name) ?? "?";
  const [name, parsedPlatform] = splitPlatform(rawName);
  const props = isObj(x.properties) ? x.properties : {};
  return {
    name,
    platform: str(props.platform) ?? parsedPlatform,
    timePlanned: str(x[`${side}TimePlanned`]),
    timeEst: str(x[`${side}TimeEstimated`]),
  };
}

function legStops(seq: unknown): LegStop[] {
  if (!Array.isArray(seq) || seq.length <= 2) return [];
  return seq.slice(1, -1).flatMap((s): LegStop[] => {
    if (!isObj(s)) return [];
    const rawName = str(s.disassembledName) ?? str(s.name);
    if (!rawName) return [];
    const [name] = splitPlatform(rawName);
    const time =
      str(s.departureTimeEstimated) ??
      str(s.departureTimePlanned) ??
      str(s.arrivalTimeEstimated) ??
      str(s.arrivalTimePlanned);
    return [{ name, time }];
  });
}

function legCancelled(leg: Record<string, unknown>): boolean {
  if (leg.isCancelled === true) return true;
  const status = leg.realtimeStatus;
  if (Array.isArray(status) && status.includes("TRIP_CANCELLED")) return true;
  const props = isObj(leg.properties) ? leg.properties : {};
  return props.cancelled === true || props.cancelled === "1";
}

function normalizeLeg(x: unknown): TransitLeg | null {
  if (!isObj(x)) return null;
  const from = legPoint(x.origin, "departure");
  const to = legPoint(x.destination, "arrival");
  const transportation = isObj(x.transportation) ? x.transportation : {};
  const product = isObj(transportation.product) ? transportation.product : {};
  const modeClass = typeof product.class === "number" ? product.class : null;
  const walk = modeClass === null || WALK_CLASSES.has(modeClass);
  const duration =
    typeof x.duration === "number" && Number.isFinite(x.duration)
      ? Math.round(x.duration / 60)
      : null;

  if (walk) {
    return {
      kind: "walk",
      modeClass: null,
      line: null,
      headsign: null,
      durationMin: duration,
      distanceM:
        typeof x.distance === "number" && Number.isFinite(x.distance)
          ? Math.round(x.distance)
          : null,
      from,
      to,
      stops: [],
      live: false,
      cancelled: false,
    };
  }

  const dest = isObj(transportation.destination)
    ? transportation.destination
    : {};
  return {
    kind: "transit",
    modeClass,
    line: str(transportation.disassembledName) ?? str(transportation.number),
    headsign: str(dest.name),
    durationMin: duration,
    distanceM: null,
    from,
    to,
    stops: legStops(x.stopSequence),
    live: x.isRealtimeControlled === true || from.timeEst !== null,
    cancelled: legCancelled(x),
  };
}

const PRIORITY_RANK: Record<string, number> = {
  veryHigh: 0,
  high: 1,
  normal: 2,
  low: 3,
  veryLow: 4,
};

/** Flatten every leg's `infos` into a deduped, priority-sorted alert strip. */
function collectAlerts(journeys: unknown[]): TransitAlert[] {
  const byId = new Map<string, TransitAlert>();
  for (const j of journeys) {
    if (!isObj(j) || !Array.isArray(j.legs)) continue;
    for (const leg of j.legs) {
      if (!isObj(leg) || !Array.isArray(leg.infos)) continue;
      for (const info of leg.infos) {
        if (!isObj(info)) continue;
        const title = str(info.subtitle) ?? str(info.urlText);
        if (!title) continue;
        const id = str(info.id) ?? title;
        if (byId.has(id)) continue;
        byId.set(id, {
          id,
          priority: str(info.priority),
          title,
          url: str(info.url),
        });
      }
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority ?? "normal"] ?? 2) -
        (PRIORITY_RANK[b.priority ?? "normal"] ?? 2),
    )
    .slice(0, 6);
}

function normalizeJourney(x: unknown): TransitJourney | null {
  if (!isObj(x) || !Array.isArray(x.legs)) return null;
  const legs = x.legs
    .map(normalizeLeg)
    .filter((l): l is TransitLeg => l !== null);
  if (legs.length === 0) return null;

  const first = legs[0];
  const last = legs[legs.length - 1];
  const firstTransit = legs.find((l) => l.kind === "transit") ?? null;

  const departPlanned = first.from.timePlanned;
  const departEst = first.from.timeEst;
  const arrivePlanned = last.to.timePlanned;
  const arriveEst = last.to.timeEst;

  // Duration from best-known endpoints; falls back to summed leg durations.
  let durationMin = delayMinutes(
    departEst ?? departPlanned,
    arriveEst ?? arrivePlanned,
  );
  if (durationMin === null || durationMin < 0) {
    const summed = legs.reduce((acc, l) => acc + (l.durationMin ?? 0), 0);
    durationMin = summed > 0 ? summed : null;
  }

  return {
    legs,
    interchanges: Math.max(
      0,
      legs.filter((l) => l.kind === "transit").length - 1,
    ),
    durationMin,
    departPlanned,
    departEst,
    arrivePlanned,
    arriveEst,
    cancelled: legs.some((l) => l.cancelled),
    live: legs.some((l) => l.live),
    delayMin: firstTransit
      ? delayMinutes(firstTransit.from.timePlanned, firstTransit.from.timeEst)
      : null,
  };
}

/** Defensive normalize of a `/trip` response — malformed journeys are dropped,
 *  a malformed response is an empty result, never a throw. */
export function normalizeTrip(json: unknown): TripResult {
  if (!isObj(json) || !Array.isArray(json.journeys))
    return { journeys: [], alerts: [] };
  return {
    journeys: json.journeys
      .map(normalizeJourney)
      .filter((j): j is TransitJourney => j !== null),
    alerts: collectAlerts(json.journeys),
  };
}

// ---------------------------------------------------------------------------
// display helpers
// ---------------------------------------------------------------------------

const SYDNEY_HM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Australia/Sydney",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO timestamp → Sydney wall clock ("08:07"); em-dash when unparseable. */
export function fmtSydneyTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return SYDNEY_HM.format(ms);
}

/** Human name for a product class ("train", "bus") — badge text fallback. */
export function modeName(modeClass: number | null): string {
  const entry = Object.entries(MODE_CLASSES).find(([, c]) => c === modeClass);
  return entry ? entry[0] : "transit";
}

// ---------------------------------------------------------------------------
// sample data — what renders when TNSW_API_KEY is unset (dev, CI)
// ---------------------------------------------------------------------------

export const SAMPLE_PLACES: PlaceCandidate[] = [
  {
    kind: "stop",
    value: "10101100",
    name: "Westmead Station",
    sub: "Westmead",
  },
  {
    kind: "coord",
    value: "150.9877,-33.8073",
    name: "Great Western Hwy, Westmead",
    sub: null,
  },
  {
    kind: "coord",
    value: "151.1932,-33.9312",
    name: "10 Bourke Rd, Mascot",
    sub: null,
  },
];

function samplePoint(
  name: string,
  platform: string | null,
  planned: string | null,
  est: string | null = null,
): LegPoint {
  return { name, platform, timePlanned: planned, timeEst: est };
}

const SAMPLE_DAY = "2026-07-17";
const t = (hm: string) => `${SAMPLE_DAY}T${hm}:00+10:00`;

/** A plausible Westmead → Mascot morning — the mockup's journey, frozen. */
export const SAMPLE_TRIP: TripResult = {
  journeys: [
    {
      legs: [
        {
          kind: "walk",
          modeClass: null,
          line: null,
          headsign: null,
          durationMin: 4,
          distanceM: 300,
          from: samplePoint("Great Western Hwy, Westmead", null, t("08:02")),
          to: samplePoint("Westmead Station", null, t("08:06")),
          stops: [],
          live: false,
          cancelled: false,
        },
        {
          kind: "transit",
          modeClass: 1,
          line: "T1",
          headsign: "City via Parramatta",
          durationMin: 32,
          distanceM: null,
          from: samplePoint("Westmead Station", "1", t("08:07"), t("08:09")),
          to: samplePoint("Central Station", "16", t("08:39"), t("08:41")),
          stops: [
            { name: "Parramatta Station", time: t("08:12") },
            { name: "Granville Station", time: t("08:16") },
            { name: "Auburn Station", time: t("08:20") },
            { name: "Lidcombe Station", time: t("08:24") },
            { name: "Strathfield Station", time: t("08:30") },
            { name: "Redfern Station", time: t("08:39") },
          ],
          live: true,
          cancelled: false,
        },
        {
          kind: "transit",
          modeClass: 1,
          line: "T8",
          headsign: "Macarthur",
          durationMin: 9,
          distanceM: null,
          from: samplePoint("Central Station", "23", t("08:48"), t("08:48")),
          to: samplePoint("Mascot Station", "2", t("08:57"), t("08:57")),
          stops: [{ name: "Green Square Station", time: t("08:53") }],
          live: true,
          cancelled: false,
        },
        {
          kind: "walk",
          modeClass: null,
          line: null,
          headsign: null,
          durationMin: 9,
          distanceM: 650,
          from: samplePoint("Mascot Station", null, t("08:57")),
          to: samplePoint("10 Bourke Rd, Mascot", null, t("09:06")),
          stops: [],
          live: false,
          cancelled: false,
        },
      ],
      interchanges: 1,
      durationMin: 64,
      departPlanned: t("08:02"),
      departEst: null,
      arrivePlanned: t("09:06"),
      arriveEst: null,
      cancelled: false,
      live: true,
      delayMin: 2,
    },
    {
      legs: [
        {
          kind: "walk",
          modeClass: null,
          line: null,
          headsign: null,
          durationMin: 4,
          distanceM: 300,
          from: samplePoint("Great Western Hwy, Westmead", null, t("08:16")),
          to: samplePoint("Westmead Station", null, t("08:20")),
          stops: [],
          live: false,
          cancelled: false,
        },
        {
          kind: "transit",
          modeClass: 1,
          line: "T1",
          headsign: "City via Parramatta",
          durationMin: 32,
          distanceM: null,
          from: samplePoint("Westmead Station", "1", t("08:14"), t("08:20")),
          to: samplePoint("Central Station", "17", t("08:46"), t("08:52")),
          stops: [],
          live: true,
          cancelled: false,
        },
        {
          kind: "transit",
          modeClass: 1,
          line: "T8",
          headsign: "Macarthur",
          durationMin: 9,
          distanceM: null,
          from: samplePoint("Central Station", "23", t("08:58"), t("08:58")),
          to: samplePoint("Mascot Station", "2", t("09:07"), t("09:07")),
          stops: [],
          live: true,
          cancelled: true,
        },
        {
          kind: "walk",
          modeClass: null,
          line: null,
          headsign: null,
          durationMin: 9,
          distanceM: 650,
          from: samplePoint("Mascot Station", null, t("09:07")),
          to: samplePoint("10 Bourke Rd, Mascot", null, t("09:16")),
          stops: [],
          live: false,
          cancelled: false,
        },
      ],
      interchanges: 1,
      durationMin: 69,
      departPlanned: t("08:16"),
      departEst: null,
      arrivePlanned: t("09:16"),
      arriveEst: null,
      cancelled: true,
      live: true,
      delayMin: 6,
    },
    {
      legs: [
        {
          kind: "walk",
          modeClass: null,
          line: null,
          headsign: null,
          durationMin: 4,
          distanceM: 300,
          from: samplePoint("Great Western Hwy, Westmead", null, t("08:02")),
          to: samplePoint("Westmead Station", null, t("08:06")),
          stops: [],
          live: false,
          cancelled: false,
        },
        {
          kind: "transit",
          modeClass: 1,
          line: "T1",
          headsign: "City via Parramatta",
          durationMin: 32,
          distanceM: null,
          from: samplePoint("Westmead Station", "1", t("08:07"), t("08:09")),
          to: samplePoint("Central Station", "16", t("08:39"), t("08:41")),
          stops: [],
          live: true,
          cancelled: false,
        },
        {
          kind: "walk",
          modeClass: null,
          line: null,
          headsign: null,
          durationMin: 3,
          distanceM: 200,
          from: samplePoint("Central Station", null, t("08:41")),
          to: samplePoint("Railway Square, Stand E", null, t("08:44")),
          stops: [],
          live: false,
          cancelled: false,
        },
        {
          kind: "transit",
          modeClass: 5,
          line: "305",
          headsign: "Mascot via Bourke Rd",
          durationMin: 22,
          distanceM: null,
          from: samplePoint("Railway Square, Stand E", null, t("08:50")),
          to: samplePoint("Bourke Rd opp Qantas Dr", null, t("09:12")),
          stops: [],
          live: false,
          cancelled: false,
        },
        {
          kind: "walk",
          modeClass: null,
          line: null,
          headsign: null,
          durationMin: 2,
          distanceM: 120,
          from: samplePoint("Bourke Rd opp Qantas Dr", null, t("09:12")),
          to: samplePoint("10 Bourke Rd, Mascot", null, t("09:14")),
          stops: [],
          live: false,
          cancelled: false,
        },
      ],
      interchanges: 1,
      durationMin: 72,
      departPlanned: t("08:02"),
      departEst: null,
      arrivePlanned: t("09:14"),
      arriveEst: null,
      cancelled: false,
      live: true,
      delayMin: 2,
    },
  ],
  alerts: [
    {
      id: "sample-t8",
      priority: "high",
      title:
        "T8 Airport & South Line — signal repairs at Green Square; allow up to 10 min extra travel time",
      url: null,
    },
  ],
};
