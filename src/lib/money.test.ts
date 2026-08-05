import { describe, expect, it } from "vitest";
import { arrow, aud, audCompact, tone } from "./money";

describe("money — aud + tone + arrow", () => {
  it("prints AUD in full, and reads a movement's direction", () => {
    expect(aud(1234.5)).toBe("$1,234.50");
    expect(tone(1)).toBe("text-up");
    expect(tone(-1)).toBe("text-down");
    expect(tone(0)).toBe("text-muted");
    expect(arrow(1)).toBe("▲");
    expect(arrow(-1)).toBe("▼");
    expect(arrow(0)).toBe("·");
  });
});

describe("money — audCompact", () => {
  it("shortens thousands and millions to one decimal", () => {
    expect(audCompact(5_300)).toBe("$5.3k");
    expect(audCompact(26_432)).toBe("$26.4k");
    expect(audCompact(1_000)).toBe("$1.0k");
    expect(audCompact(1_240_000)).toBe("$1.2M");
  });

  it("reads under a thousand in full — there is nothing to shorten", () => {
    expect(audCompact(840)).toBe("$840.00");
    expect(audCompact(0)).toBe("$0.00");
    expect(audCompact(999.99)).toBe("$999.99");
  });

  it("keeps the sign on a figure below zero", () => {
    expect(audCompact(-5_300)).toBe("-$5.3k");
  });
});
