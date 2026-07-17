/**
 * weather — the pure spine of the Sydney weather row (roadmap 51). Open-Meteo
 * is the source: free, keyless, generous — the one connector with no env var
 * at all, so "sample data" here only ever means the upstream failed. Sydney
 * is a constant, not config: the hub already tells Sydney time in its status
 * bar; its weather is the same kind of fact.
 */

export const SYDNEY = { lat: -33.8688, lon: 151.2093 };

export interface Weather {
  tempC: number;
  feelsC: number | null;
  /** WMO weather interpretation code. */
  code: number;
  uv: number | null;
  todayMinC: number | null;
  todayMaxC: number | null;
}

/** Query for Open-Meteo's forecast endpoint — current conditions + today's
 *  range, Sydney wall clock. UV rides in both `current` and `daily` because
 *  older deployments lack the current-field; the normalizer prefers current. */
export function openMeteoParams(): URLSearchParams {
  return new URLSearchParams([
    ["latitude", String(SYDNEY.lat)],
    ["longitude", String(SYDNEY.lon)],
    ["current", "temperature_2m,apparent_temperature,weather_code,uv_index"],
    ["daily", "temperature_2m_max,temperature_2m_min,uv_index_max"],
    ["timezone", "Australia/Sydney"],
    ["forecast_days", "1"],
  ]);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function firstNum(x: unknown): number | null {
  return Array.isArray(x) ? num(x[0]) : null;
}

/** Defensive normalize of an Open-Meteo response — null on anything that
 *  doesn't carry at least a current temperature and code. */
export function normalizeOpenMeteo(json: unknown): Weather | null {
  if (!isObj(json) || !isObj(json.current)) return null;
  const current = json.current;
  const daily = isObj(json.daily) ? json.daily : {};
  const tempC = num(current.temperature_2m);
  const code = num(current.weather_code);
  if (tempC === null || code === null) return null;
  return {
    tempC,
    feelsC: num(current.apparent_temperature),
    code,
    uv: num(current.uv_index) ?? firstNum(daily.uv_index_max),
    todayMinC: firstNum(daily.temperature_2m_min),
    todayMaxC: firstNum(daily.temperature_2m_max),
  };
}

/** WMO code → short text (the interpretation table, collapsed to ranges). */
export function weatherCodeText(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "mostly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code === 85 || code === 86) return "snow showers";
  if (code >= 95) return "thunderstorm";
  return "—";
}

/** WHO UV index bands. */
export function uvLabel(uv: number): string {
  if (uv < 3) return "low";
  if (uv < 6) return "moderate";
  if (uv < 8) return "high";
  if (uv < 11) return "very high";
  return "extreme";
}

/** What renders when Open-Meteo is unreachable. */
export const sampleWeather: Weather = {
  tempC: 18,
  feelsC: 16,
  code: 2,
  uv: 2,
  todayMinC: 12,
  todayMaxC: 19,
};
