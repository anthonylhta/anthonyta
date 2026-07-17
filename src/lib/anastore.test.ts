import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bytesToB64,
  isDayStats,
  MAX_TRACKED_PATHS,
  newHll,
  OVERFLOW_PATH,
  type DayStats,
} from "./analytics";
import {
  expiredDayKeys,
  mergeDays,
  pruneOldDays,
  readDays,
  recordHit,
  todayVisitorHash,
} from "./anastore";
import { r2Delete, r2Enabled, r2List, readKey, writeKey } from "./r2";

vi.mock("./r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2")>()),
  r2Enabled: vi.fn(),
  readKey: vi.fn(),
  writeKey: vi.fn(),
  r2List: vi.fn(),
  r2Delete: vi.fn(),
}));

const mockEnabled = vi.mocked(r2Enabled);
const mockRead = vi.mocked(readKey);
const mockWrite = vi.mocked(writeKey);
const mockList = vi.mocked(r2List);
const mockDelete = vi.mocked(r2Delete);

const TODAY = "2026-07-12";
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const okRead = (o: unknown) => ({ state: "ok", value: enc(o) }) as const;

/** The JSON body handed to the last writeKey call for `key`. */
function lastWriteBody(key: string): unknown {
  const call = [...mockWrite.mock.calls].reverse().find((c) => c[0] === key);
  return call ? JSON.parse(call[1] as string) : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnabled.mockReturnValue(true);
  mockWrite.mockResolvedValue("ok");
  mockList.mockResolvedValue({ objects: [] });
  mockDelete.mockResolvedValue(new Response(null, { status: 204 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("degrade (store off)", () => {
  beforeEach(() => mockEnabled.mockReturnValue(false));

  it("reads no days, records nothing, prunes nothing, hashes nothing", async () => {
    expect(await readDays(TODAY, 7)).toEqual([]);
    expect(await recordHit(TODAY, "/", newHll())).toBe(false);
    expect(await pruneOldDays(TODAY)).toBe(0);
    expect(await todayVisitorHash(TODAY, "1.2.3.4", "ua")).toBeNull();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });
});

describe("salt rotation", () => {
  it("reuses a stored salt whose date is today — no write", async () => {
    const salt = new Uint8Array(16).fill(9);
    mockRead.mockResolvedValue(
      okRead({ date: TODAY, salt_b64: bytesToB64(salt) }),
    );
    const hash = await todayVisitorHash(TODAY, "1.2.3.4", "ua");
    expect(hash).not.toBeNull();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rotates on a stale date — overwrites and discards the old salt", async () => {
    const old = new Uint8Array(16).fill(1);
    mockRead.mockResolvedValue(
      okRead({ date: "2026-07-11", salt_b64: bytesToB64(old) }),
    );
    const hash = await todayVisitorHash(TODAY, "1.2.3.4", "ua");
    expect(hash).not.toBeNull();
    const call = mockWrite.mock.calls.find(
      (c) => c[0] === "meta/analytics/salt",
    );
    expect(call).toBeDefined();
    expect(call?.[2]).toMatchObject({ overwrite: true });
    // the rotated salt is today's, not yesterday's
    const body = lastWriteBody("meta/analytics/salt") as {
      date: string;
      salt_b64: string;
    };
    expect(body.date).toBe(TODAY);
    expect(body.salt_b64).not.toBe(bytesToB64(old));
  });

  it("mints a fresh salt when none is stored yet (absent)", async () => {
    mockRead.mockResolvedValue({ state: "absent" });
    expect(await todayVisitorHash(TODAY, "1.2.3.4", "ua")).not.toBeNull();
    expect(mockWrite).toHaveBeenCalledWith(
      "meta/analytics/salt",
      expect.any(String),
      expect.objectContaining({ overwrite: true }),
    );
  });

  it("skips (null) on a read error and never clobbers a good salt", async () => {
    mockRead.mockResolvedValue({ state: "error" });
    expect(await todayVisitorHash(TODAY, "1.2.3.4", "ua")).toBeNull();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("a different day's salt unlinks the same visitor's hash", async () => {
    const s1 = new Uint8Array(16).fill(1);
    const s2 = new Uint8Array(16).fill(2);
    mockRead.mockResolvedValue(
      okRead({ date: TODAY, salt_b64: bytesToB64(s1) }),
    );
    const a = await todayVisitorHash(TODAY, "1.2.3.4", "ua");
    mockRead.mockResolvedValue(
      okRead({ date: TODAY, salt_b64: bytesToB64(s2) }),
    );
    const b = await todayVisitorHash(TODAY, "1.2.3.4", "ua");
    expect(bytesToB64(a!)).not.toBe(bytesToB64(b!));
  });
});

describe("recordHit fold", () => {
  const hashA = new Uint8Array(32).fill(3);
  const hashB = new Uint8Array(32).fill(200);

  it("creates a fresh day record on the first hit", async () => {
    mockRead.mockResolvedValue({ state: "absent" });
    expect(await recordHit(TODAY, "/projects", hashA)).toBe(true);
    const body = lastWriteBody(
      "meta/analytics/day/2026-07-12.json",
    ) as DayStats;
    expect(isDayStats(body)).toBe(true);
    expect(body.date).toBe(TODAY);
    expect(body.paths["/projects"].views).toBe(1);
    expect(body.paths["/projects"].hll_b64).not.toBe("");
    expect(body.visitors_hll_b64).not.toBe("");
  });

  it("folds a hit into an existing day — views increment, sketches grow", async () => {
    const existing: DayStats = {
      v: 1,
      date: TODAY,
      visitors_hll_b64: bytesToB64(newHll()),
      paths: { "/": { views: 5, hll_b64: bytesToB64(newHll()) } },
    };
    mockRead.mockResolvedValue(okRead(existing));
    expect(await recordHit(TODAY, "/", hashA)).toBe(true);
    const body = lastWriteBody(
      "meta/analytics/day/2026-07-12.json",
    ) as DayStats;
    expect(body.paths["/"].views).toBe(6);
  });

  it("adds a new path alongside the existing ones", async () => {
    const existing: DayStats = {
      v: 1,
      date: TODAY,
      visitors_hll_b64: bytesToB64(newHll()),
      paths: { "/": { views: 2, hll_b64: bytesToB64(newHll()) } },
    };
    mockRead.mockResolvedValue(okRead(existing));
    await recordHit(TODAY, "/contact", hashB);
    const body = lastWriteBody(
      "meta/analytics/day/2026-07-12.json",
    ) as DayStats;
    expect(body.paths["/"].views).toBe(2);
    expect(body.paths["/contact"].views).toBe(1);
  });

  /** A saturated day: MAX_TRACKED_PATHS distinct real paths, /p0…/p{n-1}. */
  const saturatedDay = (): DayStats => ({
    v: 1,
    date: TODAY,
    visitors_hll_b64: bytesToB64(newHll()),
    paths: Object.fromEntries(
      Array.from({ length: MAX_TRACKED_PATHS }, (_, i) => [
        `/p${i}`,
        { views: 1, hll_b64: bytesToB64(newHll()) },
      ]),
    ),
  });

  it("folds a new path past the cap into the overflow bucket, not a fresh key", async () => {
    mockRead.mockResolvedValue(okRead(saturatedDay()));
    expect(await recordHit(TODAY, "/wp-admin", hashA)).toBe(true);
    const body = lastWriteBody(
      "meta/analytics/day/2026-07-12.json",
    ) as DayStats;
    expect(body.paths["/wp-admin"]).toBeUndefined();
    expect(body.paths[OVERFLOW_PATH].views).toBe(1);
    // bounded: the original cap plus the single overflow bucket, nothing more.
    expect(Object.keys(body.paths).length).toBe(MAX_TRACKED_PATHS + 1);
    // the real visitor was still counted site-wide, junk path or not.
    expect(body.visitors_hll_b64).not.toBe(bytesToB64(newHll()));
  });

  it("keeps the record bounded under a flood of distinct junk paths", async () => {
    let day = saturatedDay();
    mockRead.mockImplementation(async () => okRead(day));
    for (const p of ["/.env", "/xmlrpc.php", "/../etc"]) {
      await recordHit(TODAY, p, hashB);
      day = lastWriteBody("meta/analytics/day/2026-07-12.json") as DayStats;
    }
    expect(Object.keys(day.paths).length).toBe(MAX_TRACKED_PATHS + 1);
    expect(day.paths[OVERFLOW_PATH].views).toBe(3);
  });

  it("still increments an already-tracked path on a saturated day", async () => {
    mockRead.mockResolvedValue(okRead(saturatedDay()));
    await recordHit(TODAY, "/p0", hashA);
    const body = lastWriteBody(
      "meta/analytics/day/2026-07-12.json",
    ) as DayStats;
    expect(body.paths["/p0"].views).toBe(2);
    expect(body.paths[OVERFLOW_PATH]).toBeUndefined();
    expect(Object.keys(body.paths).length).toBe(MAX_TRACKED_PATHS);
  });

  it("never clobbers a day on a flaky read", async () => {
    mockRead.mockResolvedValue({ state: "error" });
    expect(await recordHit(TODAY, "/", hashA)).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a corrupt-but-readable day record", async () => {
    mockRead.mockResolvedValue({
      state: "ok",
      value: new TextEncoder().encode("{ not json"),
    });
    expect(await recordHit(TODAY, "/", hashA)).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe("readDays", () => {
  it("returns present days oldest-first and drops missing/errored ones", async () => {
    const day = (date: string): DayStats => ({
      v: 1,
      date,
      visitors_hll_b64: bytesToB64(newHll()),
      paths: {},
    });
    mockRead.mockImplementation(async (key: string) => {
      if (key.endsWith("2026-07-12.json")) return okRead(day("2026-07-12"));
      if (key.endsWith("2026-07-11.json")) return { state: "error" };
      if (key.endsWith("2026-07-10.json")) return okRead(day("2026-07-10"));
      return { state: "absent" };
    });
    const days = await readDays(TODAY, 3);
    expect(days.map((d) => d.date)).toEqual(["2026-07-10", "2026-07-12"]);
  });
});

describe("mergeDays (pure)", () => {
  it("sums views and unions sketches across days", () => {
    const mk = (date: string, views: number): DayStats => ({
      v: 1,
      date,
      visitors_hll_b64: bytesToB64(newHll()),
      paths: { "/": { views, hll_b64: bytesToB64(newHll()) } },
    });
    const merged = mergeDays([mk("2026-07-10", 3), mk("2026-07-12", 4)]);
    expect(merged.date).toBe("2026-07-12"); // latest
    expect(merged.paths["/"].views).toBe(7);
    expect(isDayStats(merged)).toBe(true);
  });

  it("is an empty record for no days", () => {
    const merged = mergeDays([]);
    expect(merged.date).toBe("");
    expect(merged.paths).toEqual({});
  });
});

describe("expiredDayKeys (pure)", () => {
  it("selects only day keys dated before the retention cutoff", () => {
    const keys = [
      "meta/analytics/day/2026-01-01.json", // far past → expired
      "meta/analytics/day/2026-07-12.json", // today → kept
      "meta/analytics/day/nonsense.json", // unparseable → left alone
      "meta/analytics/salt", // not a day key → ignored
    ];
    expect(expiredDayKeys(keys, TODAY, 90)).toEqual([
      "meta/analytics/day/2026-01-01.json",
    ]);
  });
});

describe("pruneOldDays", () => {
  it("deletes listed day records older than the window", async () => {
    mockList.mockResolvedValue({
      objects: [
        {
          key: "meta/analytics/day/2026-01-01.json",
          size: 1,
          lastModified: "",
        },
        {
          key: "meta/analytics/day/2026-07-12.json",
          size: 1,
          lastModified: "",
        },
      ],
    });
    const count = await pruneOldDays(TODAY, 90);
    expect(count).toBe(1);
    expect(mockDelete).toHaveBeenCalledWith(
      "meta/analytics/day/2026-01-01.json",
    );
    expect(mockDelete).not.toHaveBeenCalledWith(
      "meta/analytics/day/2026-07-12.json",
    );
  });

  it("swallows a list failure and returns the count so far", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    expect(await pruneOldDays(TODAY)).toBe(0);
  });
});
