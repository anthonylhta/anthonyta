import {
  SAMPLE_PLACES,
  SAMPLE_TRIP,
  normalizeStopFinder,
  normalizeTrip,
  stopFinderParams,
  tripParams,
  type ModeFilter,
  type PlaceCandidate,
  type TransitPlace,
  type TripResult,
} from "@/lib/transit";

/**
 * transit connector — the server side of the /transit page's TfNSW proxy.
 * OWNER-ONLY surface (the routes gate; this module just fetches): the browser
 * sends origin/destination per request, this adds the API key and relays, and
 * nothing is stored — the saved trips themselves live sealed in the E2EE
 * envelope, so the server sees an address only transiently, in a query it
 * never logs.
 *
 * Unlike the dashboard connectors there is NO data-layer cache: departures go
 * stale in seconds, so every read is `cache: "no-store"`. The env split keeps
 * the house convention: no `TNSW_API_KEY` → deterministic sample data flagged
 * `sample: true` (dev/CI render end-to-end); key present but the upstream
 * fails → null, which the routes turn into a 503 the UI can name honestly —
 * a broken live feed must never quietly cosplay as sample data.
 */

const TNSW_BASE = "https://api.transport.nsw.gov.au/v1/tp";

/** One TfNSW GET. No key → null; non-2xx / throw → null (logged). */
async function tnsw(
  path: string,
  params: URLSearchParams,
  label: string,
): Promise<unknown | null> {
  const key = process.env.TNSW_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${TNSW_BASE}/${path}?${params}`, {
      headers: { Authorization: `apikey ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[connector:transit] http", res.status, label);
      return null;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    console.error("[connector:transit]", label, "failed:", err);
    return null;
  }
}

export interface PlacesRead {
  sample: boolean;
  places: PlaceCandidate[];
}

/** Free-text place search (stops, addresses, POIs). Null = live feed failed. */
export async function findPlaces(q: string): Promise<PlacesRead | null> {
  if (!process.env.TNSW_API_KEY) {
    const needle = q.toLowerCase();
    return {
      sample: true,
      places: SAMPLE_PLACES.filter((p) =>
        p.name.toLowerCase().includes(needle),
      ),
    };
  }
  const json = await tnsw("stop_finder", stopFinderParams(q), "stop_finder");
  if (json === null) return null;
  return { sample: false, places: normalizeStopFinder(json) };
}

export interface TripRead {
  sample: boolean;
  result: TripResult;
}

/** Door-to-door journeys, real-time. Null = live feed failed. */
export async function planTrip(opts: {
  from: Pick<TransitPlace, "kind" | "value">;
  to: Pick<TransitPlace, "kind" | "value">;
  modes: ModeFilter;
}): Promise<TripRead | null> {
  if (!process.env.TNSW_API_KEY) return { sample: true, result: SAMPLE_TRIP };
  const json = await tnsw("trip", tripParams(opts), "trip");
  if (json === null) return null;
  return { sample: false, result: normalizeTrip(json) };
}
