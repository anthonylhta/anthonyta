import { describe, expect, it } from "vitest";
import {
  normalizeOpenMeteo,
  openMeteoParams,
  uvLabel,
  weatherCodeText,
} from "./weather";

describe("openMeteoParams", () => {
  it("asks for Sydney's current conditions and today's range", () => {
    const p = openMeteoParams();
    expect(p.get("latitude")).toBe("-33.8688");
    expect(p.get("timezone")).toBe("Australia/Sydney");
    expect(p.get("current")).toContain("temperature_2m");
    expect(p.get("current")).toContain("uv_index");
    expect(p.get("daily")).toContain("uv_index_max");
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
        },
      }),
    ).toEqual({
      tempC: 18.4,
      feelsC: 16.1,
      code: 2,
      uv: 2.35,
      todayMinC: 11.8,
      todayMaxC: 19.2,
    });
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
