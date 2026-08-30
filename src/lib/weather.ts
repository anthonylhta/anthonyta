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
  /** Today's max chance of precipitation, percent. */
  rainChance: number | null;
  /** Today's hourly chance of precipitation, percent — exactly 24 values,
   *  index = the Sydney hour. Null when the response didn't carry a clean
   *  day of them; a ragged array can't be read by hour. */
  rainHours: number[] | null;
  todayMinC: number | null;
  todayMaxC: number | null;
}

/** Query for Open-Meteo's forecast endpoint — current conditions + today's
 *  range, Sydney wall clock. UV rides in both `current` and `daily` because
 *  older deployments lack the current-field; the normalizer prefers current.
 *  The hourly rain chances arrive as 24 values covering the Sydney calendar
 *  day — timezone pinned, one forecast day — so the index IS the hour. */
export function openMeteoParams(): URLSearchParams {
  return new URLSearchParams([
    ["latitude", String(SYDNEY.lat)],
    ["longitude", String(SYDNEY.lon)],
    ["current", "temperature_2m,apparent_temperature,weather_code,uv_index"],
    [
      "daily",
      "temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max",
    ],
    ["hourly", "precipitation_probability"],
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

/** An hourly series as exactly 24 finite numbers — the first 24 when the
 *  upstream sends more (a forecast that spills past midnight). All or
 *  nothing: one hole and the whole day stops being indexable by hour. */
function hours24(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length < 24) return null;
  const hours: number[] = [];
  for (const v of x.slice(0, 24)) {
    const n = num(v);
    if (n === null) return null;
    hours.push(n);
  }
  return hours;
}

/** Defensive normalize of an Open-Meteo response — null on anything that
 *  doesn't carry at least a current temperature and code. */
export function normalizeOpenMeteo(json: unknown): Weather | null {
  if (!isObj(json) || !isObj(json.current)) return null;
  const current = json.current;
  const daily = isObj(json.daily) ? json.daily : {};
  const hourly = isObj(json.hourly) ? json.hourly : {};
  const tempC = num(current.temperature_2m);
  const code = num(current.weather_code);
  if (tempC === null || code === null) return null;
  return {
    tempC,
    feelsC: num(current.apparent_temperature),
    code,
    uv: num(current.uv_index) ?? firstNum(daily.uv_index_max),
    rainChance: firstNum(daily.precipitation_probability_max),
    rainHours: hours24(hourly.precipitation_probability),
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

/** A contiguous stretch of the rest of today worth carrying an umbrella for.
 *  `to` is exclusive, so 24 means it runs on through midnight. */
export interface RainWindow {
  from: number;
  to: number;
  max: number;
}

/** The next stretch of rain from `nowHour` on — the first run of hours at 30%
 *  or more, which may start at `nowHour` itself when it's already raining.
 *  Only the first: the row answers "when do I take the walk", and a second
 *  shower after tea isn't that answer. */
export function rainWindow(
  hours: number[] | null | undefined,
  nowHour: number,
): RainWindow | null {
  // `== null` for the same reason rainLabel has one below: a Weather cached
  // by the previous deploy predates this field and arrives undefined.
  if (hours == null) return null;
  let from = nowHour;
  while (from < 24 && hours[from] < 30) from++;
  if (from >= 24) return null;
  let to = from;
  while (to < 24 && hours[to] >= 30) to++;
  return { from, to, max: Math.max(...hours.slice(from, to)) };
}

/** An hour of the day in the row's voice — `12am`, `2pm`. 24 is midnight
 *  again, the exclusive end of a window that runs through the night. */
export function hourLabel(h: number): string {
  const hour = h % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "am" : "pm"}`;
}

/** `2–5pm`, sharing the meridiem when both ends carry it — the same voice as
 *  the row's `12–19°` temperature range. */
function windowText(from: number, to: number): string {
  const a = hourLabel(from);
  const b = hourLabel(to);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
}

/** Rain chance, said only when it's worth saying: under 30% the row stays
 *  quiet (this is a glance, not a forecast), 60% and over earns the amber.
 *  Given a `window` it says WHEN instead — and a null window is an answer
 *  too (the rest of today is dry), never a fall back to the day's max. */
export function rainLabel(
  chance: number | null,
  window?: RainWindow | null,
): { text: string; tone: "amber" | "muted" } | null {
  if (window !== undefined) {
    if (window === null) return null;
    const when =
      window.to === 24
        ? `from ${hourLabel(window.from)}`
        : windowText(window.from, window.to);
    return {
      text: `rain ${when} ${Math.round(window.max)}%`,
      tone: window.max >= 60 ? "amber" : "muted",
    };
  }
  // `== null` on purpose: a Weather cached by the previous deploy predates
  // this field and arrives undefined, not null — that must read as quiet too.
  if (chance == null || chance < 30) return null;
  return {
    text: `rain ${Math.round(chance)}%`,
    tone: chance >= 60 ? "amber" : "muted",
  };
}

const SYDNEY_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Australia/Sydney",
  hour: "2-digit",
  hour12: false,
});

/** The Sydney wall-clock hour, 0–23. Its own formatter rather than
 *  lib/transit's `sydneyDateTime`: this spine stays standalone, and the
 *  "midnight renders as 24" quirk that one documents costs a `% 24` here. */
export function sydneyHour(now: Date = new Date()): number {
  return Number(SYDNEY_HOUR.format(now)) % 24;
}

/** The rain flag for the row. Hourly data answers "when" and is trusted
 *  completely, its silence included; only a Weather carrying none of it — an
 *  older cache, an upstream that dropped the field — falls back to the day's
 *  max chance. Lives here so that undefined-vs-null distinction is tested. */
export function rainLabelFor(
  wx: Weather,
  nowHour: number,
): { text: string; tone: "amber" | "muted" } | null {
  return rainLabel(
    wx.rainChance,
    wx.rainHours == null ? undefined : rainWindow(wx.rainHours, nowHour),
  );
}

/** What renders when Open-Meteo is unreachable. */
export const sampleWeather: Weather = {
  tempC: 18,
  feelsC: 16,
  code: 2,
  uv: 2,
  rainChance: 10,
  rainHours: null,
  todayMinC: 12,
  todayMaxC: 19,
};
