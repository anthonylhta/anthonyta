import { describe, expect, it } from "vitest";
import {
  hourLabel,
  normalizeOpenMeteo,
  openMeteoParams,
  rainLabel,
  rainLabelFor,
  rainWindow,
  sampleWeather,
  sydneyHour,
  uvLabel,
  weatherCodeText,
  type Weather,
} from "./weather";

/** A dry day with one run of `chance` written from `from` to `to`. */
function dayWithRain(from: number, to: number, chance: number): number[] {
  const hours = new Array<number>(24).fill(5);
  for (let h = from; h < to; h++) hours[h] = chance;
  return hours;
}

describe("openMeteoParams", () => {
  it("asks for Sydney's current conditions and today's range", () => {
    const p = openMeteoParams();
    expect(p.get("latitude")).toBe("-33.8688");
    expect(p.get("timezone")).toBe("Australia/Sydney");
    expect(p.get("current")).toContain("temperature_2m");
    expect(p.get("current")).toContain("uv_index");
    expect(p.get("daily")).toContain("uv_index_max");
    expect(p.get("daily")).toContain("precipitation_probability_max");
    expect(p.get("hourly")).toBe("precipitation_probability");
    expect(p.get("forecast_days")).toBe("1");
  });
});

describe("normalizeOpenMeteo", () => {
  it("reads current conditions, preferring the current uv", () => {
    expect(
      normalizeOpenMeteo({
        current: {
          temperature_2m: 18.4,
          apparent_temperature: 16.1,
          weather_code: 2,
          uv_index: 2.35,
        },
        daily: {
          temperature_2m_max: [19.2],
          temperature_2m_min: [11.8],
          uv_index_max: [6.1],
          precipitation_probability_max: [70],
        },
      }),
    ).toEqual({
      tempC: 18.4,
      feelsC: 16.1,
      code: 2,
      uv: 2.35,
      rainChance: 70,
      rainHours: null,
      todayMinC: 11.8,
      todayMaxC: 19.2,
    });
  });

  it("reads a full day of hourly rain chances", () => {
    const hours = dayWithRain(14, 17, 70);
    const w = normalizeOpenMeteo({
      current: { temperature_2m: 18, weather_code: 0 },
      hourly: { precipitation_probability: hours },
    });
    expect(w?.rainHours).toEqual(hours);
  });

  it("takes the first 24 when the forecast spills past midnight", () => {
    const w = normalizeOpenMeteo({
      current: { temperature_2m: 18, weather_code: 0 },
      hourly: {
        precipitation_probability: [...dayWithRain(14, 17, 70), 80, 80, 80],
      },
    });
    expect(w?.rainHours).toHaveLength(24);
    expect(w?.rainHours?.[14]).toBe(70);
  });

  it("refuses a short or holed hourly series", () => {
    const short = normalizeOpenMeteo({
      current: { temperature_2m: 18, weather_code: 0 },
      hourly: { precipitation_probability: dayWithRain(0, 0, 0).slice(0, 23) },
    });
    expect(short?.rainHours).toBeNull();

    const holed = dayWithRain(14, 17, 70);
    holed[3] = null as unknown as number;
    expect(
      normalizeOpenMeteo({
        current: { temperature_2m: 18, weather_code: 0 },
        hourly: { precipitation_probability: holed },
      })?.rainHours,
    ).toBeNull();
  });

  it("tolerates a response with no hourly block at all", () => {
    const w = normalizeOpenMeteo({
      current: { temperature_2m: 18, weather_code: 0 },
      daily: { precipitation_probability_max: [70] },
    });
    expect(w?.rainHours).toBeNull();
  });

  it("falls back to the daily uv max when current lacks it", () => {
    const w = normalizeOpenMeteo({
      current: { temperature_2m: 18, weather_code: 0 },
      daily: { uv_index_max: [6.1] },
    });
    expect(w?.uv).toBe(6.1);
    expect(w?.feelsC).toBeNull();
    expect(w?.todayMaxC).toBeNull();
  });

  it("tolerates a response with no rain chance in it", () => {
    const w = normalizeOpenMeteo({
      current: { temperature_2m: 18, weather_code: 0 },
      daily: { temperature_2m_max: [19.2] },
    });
    expect(w?.rainChance).toBeNull();
  });

  it("nulls out on anything missing the essentials", () => {
    expect(normalizeOpenMeteo(null)).toBeNull();
    expect(normalizeOpenMeteo({})).toBeNull();
    expect(normalizeOpenMeteo({ current: { weather_code: 2 } })).toBeNull();
    expect(
      normalizeOpenMeteo({ current: { temperature_2m: "18" } }),
    ).toBeNull();
  });
});

describe("weatherCodeText", () => {
  it("names the WMO ranges", () => {
    expect(weatherCodeText(0)).toBe("clear");
    expect(weatherCodeText(2)).toBe("partly cloudy");
    expect(weatherCodeText(3)).toBe("overcast");
    expect(weatherCodeText(48)).toBe("fog");
    expect(weatherCodeText(55)).toBe("drizzle");
    expect(weatherCodeText(63)).toBe("rain");
    expect(weatherCodeText(81)).toBe("showers");
    expect(weatherCodeText(96)).toBe("thunderstorm");
    expect(weatherCodeText(42)).toBe("—");
  });
});

describe("rainLabel", () => {
  it("says nothing below 30%", () => {
    expect(rainLabel(null)).toBeNull();
    expect(rainLabel(0)).toBeNull();
    expect(rainLabel(29)).toBeNull();
  });

  it("is muted from 30 to 59, amber from 60", () => {
    expect(rainLabel(30)).toEqual({ text: "rain 30%", tone: "muted" });
    expect(rainLabel(59)).toEqual({ text: "rain 59%", tone: "muted" });
    expect(rainLabel(60)).toEqual({ text: "rain 60%", tone: "amber" });
    expect(rainLabel(100)).toEqual({ text: "rain 100%", tone: "amber" });
  });

  it("rounds the percent", () => {
    expect(rainLabel(44.6)?.text).toBe("rain 45%");
  });

  it("says when, sharing the meridiem across the range", () => {
    expect(rainLabel(70, { from: 14, to: 17, max: 70 })).toEqual({
      text: "rain 2–5pm 70%",
      tone: "amber",
    });
    expect(rainLabel(70, { from: 11, to: 14, max: 40 })).toEqual({
      text: "rain 11am–2pm 40%",
      tone: "muted",
    });
  });

  it("keeps the 60% amber threshold on the window's max", () => {
    expect(rainLabel(10, { from: 9, to: 10, max: 59 })?.tone).toBe("muted");
    expect(rainLabel(10, { from: 9, to: 10, max: 60 })?.tone).toBe("amber");
    expect(rainLabel(10, { from: 9, to: 10, max: 59.6 })?.text).toBe(
      "rain 9–10am 60%",
    );
  });

  it("says 'from' when the rain runs on through midnight", () => {
    expect(rainLabel(70, { from: 20, to: 24, max: 70 })?.text).toBe(
      "rain from 8pm 70%",
    );
  });

  it("stays quiet on a dry rest of the day, whatever the daily max was", () => {
    expect(rainLabel(90, null)).toBeNull();
  });
});

describe("rainWindow", () => {
  it("finds a run already under way", () => {
    expect(rainWindow(dayWithRain(14, 17, 70), 14)).toEqual({
      from: 14,
      to: 17,
      max: 70,
    });
  });

  it("finds a run later today", () => {
    expect(rainWindow(dayWithRain(14, 17, 70), 9)).toEqual({
      from: 14,
      to: 17,
      max: 70,
    });
  });

  it("ends at 24 when the run reaches midnight", () => {
    expect(rainWindow(dayWithRain(20, 24, 50), 18)).toEqual({
      from: 20,
      to: 24,
      max: 50,
    });
  });

  it("takes the peak of the run, not of the day", () => {
    const hours = dayWithRain(14, 17, 40);
    hours[15] = 70;
    hours[21] = 95;
    expect(rainWindow(hours, 9)).toEqual({ from: 14, to: 17, max: 70 });
  });

  it("reports only the first of two runs", () => {
    const hours = dayWithRain(9, 11, 40);
    for (let h = 15; h < 18; h++) hours[h] = 80;
    expect(rainWindow(hours, 8)).toEqual({ from: 9, to: 11, max: 40 });
  });

  it("ignores a run that already passed", () => {
    expect(rainWindow(dayWithRain(6, 8, 90), 12)).toBeNull();
  });

  it("is null on a day with nothing left worth saying", () => {
    expect(rainWindow(dayWithRain(0, 0, 0), 12)).toBeNull();
    expect(rainWindow(null, 12)).toBeNull();
    expect(rainWindow(undefined, 12)).toBeNull();
  });
});

describe("hourLabel", () => {
  it("says the hour the way the row does", () => {
    expect(hourLabel(0)).toBe("12am");
    expect(hourLabel(11)).toBe("11am");
    expect(hourLabel(12)).toBe("12pm");
    expect(hourLabel(13)).toBe("1pm");
    expect(hourLabel(23)).toBe("11pm");
    expect(hourLabel(24)).toBe("12am");
  });
});

describe("rainLabelFor", () => {
  it("prefers the hourly answer, silence included", () => {
    const wet = {
      ...sampleWeather,
      rainChance: 90,
      rainHours: dayWithRain(14, 17, 70),
    };
    expect(rainLabelFor(wet, 9)?.text).toBe("rain 2–5pm 70%");
    // The shower already passed: a high daily max no longer speaks for it.
    expect(rainLabelFor(wet, 18)).toBeNull();
  });

  it("falls back to the day's max when there are no hours at all", () => {
    expect(rainLabelFor({ ...sampleWeather, rainChance: 70 }, 9)?.text).toBe(
      "rain 70%",
    );
    // A Weather cached by the previous deploy carries no field at all.
    const stale = {
      ...sampleWeather,
      rainChance: 70,
      rainHours: undefined,
    } as unknown as Weather;
    expect(rainLabelFor(stale, 9)?.text).toBe("rain 70%");
  });
});

describe("sydneyHour", () => {
  it("reads the Sydney wall clock through both offsets", () => {
    // AEST, UTC+10: 22:30Z is 08:30 the next morning in Sydney.
    expect(sydneyHour(new Date("2026-06-15T22:30:00Z"))).toBe(8);
    // AEDT, UTC+11: the same instant in January is 09:30.
    expect(sydneyHour(new Date("2026-01-15T22:30:00Z"))).toBe(9);
    // Midnight is hour 0, however the formatter chooses to render it.
    expect(sydneyHour(new Date("2026-06-14T14:00:00Z"))).toBe(0);
  });
});

describe("uvLabel", () => {
  it("bands per WHO", () => {
    expect(uvLabel(0)).toBe("low");
    expect(uvLabel(2.9)).toBe("low");
    expect(uvLabel(3)).toBe("moderate");
    expect(uvLabel(6)).toBe("high");
    expect(uvLabel(8)).toBe("very high");
    expect(uvLabel(11)).toBe("extreme");
  });
});
