import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCspDay, type CspDay } from "./cspreport";
import { readCspDays, readDay, writeDay } from "./cspstore";
import { r2Enabled, readKey, writeKey } from "./r2";

vi.mock("./r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2")>()),
  r2Enabled: vi.fn(),
  readKey: vi.fn(),
  writeKey: vi.fn(),
}));

const mockEnabled = vi.mocked(r2Enabled);
const mockRead = vi.mocked(readKey);
const mockWrite = vi.mocked(writeKey);

const TODAY = "2026-07-13";
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const okRead = (o: unknown) => ({ state: "ok", value: enc(o) }) as const;
const day = (date: string): CspDay => ({
  ...emptyCspDay(date),
  counts: { "img-src|https://x|/": 1 },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockEnabled.mockReturnValue(true);
  mockWrite.mockResolvedValue("ok");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("degrade (store off)", () => {
  it("reads no days when the store is off — no I/O", async () => {
    mockEnabled.mockReturnValue(false);
    expect(await readCspDays(TODAY, 7)).toEqual([]);
    expect(mockRead).not.toHaveBeenCalled();
  });
});

describe("readDay three-state", () => {
  it("passes absent/error through untouched", async () => {
    mockRead.mockResolvedValueOnce({ state: "absent" });
    expect(await readDay(TODAY)).toEqual({ state: "absent" });
    mockRead.mockResolvedValueOnce({ state: "error" });
    expect(await readDay(TODAY)).toEqual({ state: "error" });
  });

  it("returns a well-formed record as ok", async () => {
    mockRead.mockResolvedValue(okRead(day(TODAY)));
    const r = await readDay(TODAY);
    expect(r.state).toBe("ok");
    expect(r.state === "ok" && r.value.counts["img-src|https://x|/"]).toBe(1);
  });

  it("collapses a corrupt-but-readable record to error (never absent)", async () => {
    mockRead.mockResolvedValue({
      state: "ok",
      value: new TextEncoder().encode("{ not json"),
    });
    expect(await readDay(TODAY)).toEqual({ state: "error" });
  });
});

describe("writeDay + readCspDays", () => {
  it("writes today's record with overwrite", async () => {
    expect(await writeDay(day(TODAY))).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith(
      "meta/csp/2026-07-13.json",
      expect.any(String),
      expect.objectContaining({ overwrite: true }),
    );
  });

  it("returns present days oldest-first, dropping missing/errored ones", async () => {
    mockRead.mockImplementation(async (key: string) => {
      if (key.endsWith("2026-07-13.json")) return okRead(day("2026-07-13"));
      if (key.endsWith("2026-07-12.json")) return { state: "error" };
      if (key.endsWith("2026-07-11.json")) return okRead(day("2026-07-11"));
      return { state: "absent" };
    });
    const days = await readCspDays(TODAY, 3);
    expect(days.map((d) => d.date)).toEqual(["2026-07-11", "2026-07-13"]);
  });
});
