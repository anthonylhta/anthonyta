import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { authorizeCron } from "@/lib/cron-auth";
import { isSnapIndex, sydneyToday } from "@/lib/fin";
import { getSnapIndex, putSnapIndex } from "@/lib/finstore";
import { sweepExpiredShares } from "@/lib/shares";
import { GET } from "./route";

// The cron gates on `authorizeCron`, never `auth` — mock the gate to open (null) or
// short-circuit with a 401. The finstore, the reading connector, and the share sweep
// are the route's only collaborators since ADR 0061 retired the sealed-box job.
vi.mock("@/lib/cron-auth", () => ({ authorizeCron: vi.fn() }));
vi.mock("@/lib/finstore", () => ({
  getSnapIndex: vi.fn(),
  putSnapIndex: vi.fn(),
}));
vi.mock("@/lib/connectors/webnovel", () => ({ getCurrentlyReading: vi.fn() }));
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

describe("snapshot cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeCron).mockReturnValue(null); // authorized
    vi.mocked(getCurrentlyReading).mockResolvedValue([reading(7)]);
    vi.mocked(getSnapIndex).mockResolvedValue({ state: "absent" });
    vi.mocked(putSnapIndex).mockResolvedValue(true);
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
});
