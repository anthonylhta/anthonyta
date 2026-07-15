import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTft } from "@/lib/connectors/tft";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { authorizeCron } from "@/lib/cron-auth";
import { isSnapIndex, sydneyToday } from "@/lib/fin";
import { getSnapIndex, putSnapIndex } from "@/lib/finstore";
import { sweepExpiredShares } from "@/lib/shares";
import { isTftHistory, sampleTft, type TftStats } from "@/lib/tft";
import { getTftHistoryRaw, putTftHistory } from "@/lib/tftstore";
import { GET } from "./route";

// The cron gates on `authorizeCron`, never `auth` — mock the gate to open (null) or
// short-circuit with a 401. The finstore, the tft connector + store, the reading
// connector, and the share sweep are the route's only collaborators.
vi.mock("@/lib/cron-auth", () => ({ authorizeCron: vi.fn() }));
vi.mock("@/lib/finstore", () => ({
  getSnapIndex: vi.fn(),
  putSnapIndex: vi.fn(),
}));
vi.mock("@/lib/connectors/webnovel", () => ({ getCurrentlyReading: vi.fn() }));
vi.mock("@/lib/connectors/tft", () => ({ getTft: vi.fn() }));
vi.mock("@/lib/tftstore", () => ({
  getTftHistoryRaw: vi.fn(),
  putTftHistory: vi.fn(),
}));
vi.mock("@/lib/shares", () => ({ sweepExpiredShares: vi.fn() }));

const req = () => new Request("http://localhost/api/cron/snapshot");

/** One currently-reading row at `chapter`. */
function reading(chapter: number) {
  return {
    title: "t",
    chapter,
    total: null,
    updatedAt: "2026-07-09T00:00:00Z",
  };
}

/** A live, ranked TFT stat — the only thing the cron will record. */
function liveTft(): TftStats {
  return {
    ...sampleTft,
    isLive: true,
    rank: { tier: "MASTER", division: null, lp: 21 },
    gamesThisSet: 312,
  };
}

describe("snapshot cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeCron).mockReturnValue(null); // authorized
    vi.mocked(getCurrentlyReading).mockResolvedValue([reading(7)]);
    vi.mocked(getSnapIndex).mockResolvedValue({ state: "absent" });
    vi.mocked(putSnapIndex).mockResolvedValue(true);
    vi.mocked(getTft).mockResolvedValue(liveTft());
    vi.mocked(getTftHistoryRaw).mockResolvedValue({ state: "absent" });
    vi.mocked(putTftHistory).mockResolvedValue(true);
    vi.mocked(sweepExpiredShares).mockResolvedValue(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the 401 from authorizeCron and touches nothing", async () => {
    vi.mocked(authorizeCron).mockReturnValue(
      new Response("Unauthorized", { status: 401 }),
    );
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(getCurrentlyReading).not.toHaveBeenCalled();
    expect(getSnapIndex).not.toHaveBeenCalled();
    expect(putSnapIndex).not.toHaveBeenCalled();
    expect(getTft).not.toHaveBeenCalled();
    expect(getTftHistoryRaw).not.toHaveBeenCalled();
    expect(putTftHistory).not.toHaveBeenCalled();
    expect(sweepExpiredShares).not.toHaveBeenCalled();
  });

  it("fails the index on a flaky read instead of clobbering history", async () => {
    vi.mocked(getSnapIndex).mockResolvedValue({ state: "error" });

    const body = await (await GET(req())).json();
    expect(body.index).toBe("failed");
    expect(putSnapIndex).not.toHaveBeenCalled();
  });

  it("writes a fresh single-day index when none exists yet", async () => {
    vi.mocked(getCurrentlyReading).mockResolvedValue([
      reading(12),
      reading(30),
    ]);
    vi.mocked(getSnapIndex).mockResolvedValue({ state: "absent" });

    const body = await (await GET(req())).json();
    expect(body.index).toBe("written");

    const stored = JSON.parse(vi.mocked(putSnapIndex).mock.calls[0][0]);
    expect(isSnapIndex(stored)).toBe(true);
    expect(stored.days).toEqual([{ date: body.date, readingChapters: 42 }]);
  });

  it("upserts today into an existing index — replacing the same day, keeping the rest", async () => {
    const today = sydneyToday();
    vi.mocked(getCurrentlyReading).mockResolvedValue([reading(7)]);
    vi.mocked(getSnapIndex).mockResolvedValue({
      state: "ok",
      value: JSON.stringify({
        v: 1,
        days: [
          { date: "2020-01-01", readingChapters: 5 },
          { date: today, readingChapters: 999 }, // stale — must be replaced
        ],
      }),
    });

    const body = await (await GET(req())).json();
    expect(body.index).toBe("written");

    const stored = JSON.parse(vi.mocked(putSnapIndex).mock.calls[0][0]);
    expect(isSnapIndex(stored)).toBe(true);
    expect(stored.days).toEqual([
      { date: "2020-01-01", readingChapters: 5 },
      { date: today, readingChapters: 7 },
    ]);
  });

  it("fails the index on an unrecognizable stored shape rather than overwrite it", async () => {
    vi.mocked(getSnapIndex).mockResolvedValue({
      state: "ok",
      value: '{"v":99,"days":"??"}',
    });

    const body = await (await GET(req())).json();
    expect(body.index).toBe("failed");
    expect(putSnapIndex).not.toHaveBeenCalled();
  });

  it("skips the index when reading is unavailable, never forcing a 0", async () => {
    vi.mocked(getCurrentlyReading).mockResolvedValue([]);

    const body = await (await GET(req())).json();
    expect(body.index).toBe("skipped");
    expect(putSnapIndex).not.toHaveBeenCalled();
  });

  it("reaps expired share envelopes and reports the count", async () => {
    vi.mocked(sweepExpiredShares).mockResolvedValue(3);

    const body = await (await GET(req())).json();
    expect(body.swept).toBe(3);
    expect(sweepExpiredShares).toHaveBeenCalledTimes(1);
  });

  it("reports swept: -1 on a sweep failure without sinking the snapshot", async () => {
    vi.mocked(sweepExpiredShares).mockRejectedValue(new Error("store flake"));

    const body = await (await GET(req())).json();
    expect(body.swept).toBe(-1);
    // The snapshot's own outcomes are unaffected — the sweep is fully independent.
    expect(body.index).toBe("written");
  });

  it("skips the tft history when the ladder is sample data", async () => {
    vi.mocked(getTft).mockResolvedValue(sampleTft); // isLive false

    const body = await (await GET(req())).json();
    expect(body.tft).toBe("skipped");
    expect(putTftHistory).not.toHaveBeenCalled();
  });

  it("fails the tft history on a flaky read instead of clobbering it", async () => {
    vi.mocked(getTftHistoryRaw).mockResolvedValue({ state: "error" });

    const body = await (await GET(req())).json();
    expect(body.tft).toBe("failed");
    expect(putTftHistory).not.toHaveBeenCalled();
  });

  it("writes a fresh single-day tft history when none exists yet", async () => {
    vi.mocked(getTftHistoryRaw).mockResolvedValue({ state: "absent" });

    const body = await (await GET(req())).json();
    expect(body.tft).toBe("written");

    const stored = JSON.parse(vi.mocked(putTftHistory).mock.calls[0][0]);
    expect(isTftHistory(stored)).toBe(true);
    expect(stored.days).toEqual([
      {
        date: body.date,
        tier: "MASTER",
        division: null,
        lp: 21,
        games: 312,
      },
    ]);
  });

  it("upserts today into an existing tft history — replacing the same day", async () => {
    const today = sydneyToday();
    vi.mocked(getTftHistoryRaw).mockResolvedValue({
      state: "ok",
      value: JSON.stringify({
        v: 1,
        days: [
          { date: "2020-01-01", tier: "GOLD", division: "I", lp: 50, games: 3 },
          { date: today, tier: "PLATINUM", division: "IV", lp: 10, games: 5 }, // stale
        ],
      }),
    });

    const body = await (await GET(req())).json();
    expect(body.tft).toBe("written");

    const stored = JSON.parse(vi.mocked(putTftHistory).mock.calls[0][0]);
    expect(isTftHistory(stored)).toBe(true);
    expect(stored.days).toEqual([
      { date: "2020-01-01", tier: "GOLD", division: "I", lp: 50, games: 3 },
      { date: today, tier: "MASTER", division: null, lp: 21, games: 312 },
    ]);
  });

  it("fails the tft history on unparseable stored JSON rather than overwrite it", async () => {
    vi.mocked(getTftHistoryRaw).mockResolvedValue({
      state: "ok",
      value: "{not json",
    });

    const body = await (await GET(req())).json();
    expect(body.tft).toBe("failed");
    expect(putTftHistory).not.toHaveBeenCalled();
  });
});
