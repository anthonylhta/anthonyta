import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredBriefing } from "@/lib/briefingstore";
import { getChoreReads } from "@/lib/connectors/chores";
import { probeHealth } from "@/lib/connectors/health";
import { getTft } from "@/lib/connectors/tft";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { authorizeCron } from "@/lib/cron-auth";
import { isSnapIndex, sydneyDaysAgo, sydneyToday } from "@/lib/fin";
import { getSnapIndex, putSnapIndex } from "@/lib/finstore";
import {
  EMPTY_PUSH_CONFIG,
  serializePushConfig,
  utcToday,
  type PushConfig,
} from "@/lib/push";
import { deliver, pushConfigured } from "@/lib/pushsend";
import { getPushRaw, putPush } from "@/lib/pushstore";
import { sampleBriefing } from "@/lib/sampleBriefing";
import { sweepExpiredShares } from "@/lib/shares";
import { getSleepRaw } from "@/lib/sleepstore";
import { getStepsRaw } from "@/lib/stepsstore";
import { isTftHistory, sampleTft, type TftStats } from "@/lib/tft";
import { getTftHistoryRaw, putTftHistory } from "@/lib/tftstore";
import { GET } from "./route";

// The cron gates on `authorizeCron`, never `auth` — mock the gate to open (null) or
// short-circuit with a 401. The finstore, the tft connector + store, the reading
// connector, and the share sweep are the route's snapshot collaborators; the push
// send path, its config store, and the three ingest stores are the alarm's.
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
vi.mock("@/lib/pushsend", () => ({
  deliver: vi.fn(),
  pushConfigured: vi.fn(),
}));
vi.mock("@/lib/pushstore", () => ({ getPushRaw: vi.fn(), putPush: vi.fn() }));
vi.mock("@/lib/stepsstore", () => ({ getStepsRaw: vi.fn() }));
vi.mock("@/lib/sleepstore", () => ({ getSleepRaw: vi.fn() }));
vi.mock("@/lib/briefingstore", () => ({ getStoredBriefing: vi.fn() }));
vi.mock("@/lib/connectors/chores", () => ({ getChoreReads: vi.fn() }));
vi.mock("@/lib/connectors/health", () => ({ probeHealth: vi.fn() }));

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

/** A stored push config with one device enrolled and every category on. */
function storedPush(episodes: PushConfig["episodes"] = {}): string {
  return serializePushConfig({
    ...EMPTY_PUSH_CONFIG,
    subs: [
      {
        id: "id-1",
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
        label: "android",
        created: "2026-08-20T09:00:00.000Z",
      },
    ],
    episodes,
  });
}

/** A stored briefing FOR the given Sydney day. */
const briefingFor = (date: string) =>
  ({ state: "ok", value: { ...sampleBriefing, date } }) as const;

/** The UTC calendar day `n` days back — the briefing's own reckoning. */
const utcDaysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

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
    // The notification jobs are OFF by default (no VAPID in CI), which is what
    // every snapshot test above assumes; the alarm block below turns them on.
    vi.mocked(pushConfigured).mockReturnValue(false);
    vi.mocked(deliver).mockResolvedValue([]);
    vi.mocked(getPushRaw).mockResolvedValue({ state: "absent" });
    vi.mocked(putPush).mockResolvedValue(true);
    vi.mocked(getStepsRaw).mockResolvedValue({ state: "absent" });
    vi.mocked(getSleepRaw).mockResolvedValue({ state: "absent" });
    vi.mocked(getStoredBriefing).mockResolvedValue({ state: "absent" });
    vi.mocked(getChoreReads).mockResolvedValue({
      vaultSyncedAt: null,
      backupAt: null,
      apertureSealedAt: null,
    });
    vi.mocked(probeHealth).mockResolvedValue({ ok: true, ms: 12 });
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

  describe("the ingest-staleness alarm", () => {
    beforeEach(() => {
      vi.mocked(pushConfigured).mockReturnValue(true);
      vi.mocked(getPushRaw).mockResolvedValue({
        state: "ok",
        value: storedPush(),
      });
    });

    /** The lines the cron actually pushed under the "ingest" category. */
    const ingestBodies = () =>
      vi
        .mocked(deliver)
        .mock.calls.filter((c) => c[1] === "ingest")
        .map((c) => c[2]);

    it("buzzes the night a morning briefing does not land", async () => {
      vi.mocked(getStoredBriefing).mockResolvedValue(
        briefingFor(utcDaysAgo(1)),
      );

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("written");
      expect(ingestBodies()).toEqual(["briefing last posted 1d ago"]);
    });

    it("stays quiet on a morning the briefing landed", async () => {
      vi.mocked(getStoredBriefing).mockResolvedValue(briefingFor(utcToday()));

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("skipped");
      expect(ingestBodies()).toEqual([]);
    });

    it("says it once, not once a night, while the routine stays quiet", async () => {
      const quiet = utcDaysAgo(2);
      vi.mocked(getStoredBriefing).mockResolvedValue(briefingFor(quiet));
      vi.mocked(getPushRaw).mockResolvedValue({
        state: "ok",
        value: storedPush({ briefing: quiet }),
      });

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("skipped");
      expect(ingestBodies()).toEqual([]);
    });

    it("never alarms off a briefing store it could not read", async () => {
      vi.mocked(getStoredBriefing).mockResolvedValue({ state: "error" });

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("skipped");
      expect(ingestBodies()).toEqual([]);
    });

    it("never alarms for a briefing that has never been ingested", async () => {
      vi.mocked(getStoredBriefing).mockResolvedValue({ state: "absent" });

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("skipped");
      expect(ingestBodies()).toEqual([]);
    });

    it("never alarms off a briefing stamp that is not a day", async () => {
      vi.mocked(getStoredBriefing).mockResolvedValue({
        state: "ok",
        value: { ...sampleBriefing, date: "tue 25 aug" },
      });

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("skipped");
      expect(ingestBodies()).toEqual([]);
    });

    it("keeps the phone's feeds on the Sydney day and their own two-day window", async () => {
      // Yesterday for steps is inside the window; for the briefing it would not be.
      vi.mocked(getStepsRaw).mockResolvedValue({
        state: "ok",
        value: JSON.stringify({ v: 1, days: { [sydneyDaysAgo(1)]: 8423 } }),
      });
      vi.mocked(getStoredBriefing).mockResolvedValue(briefingFor(utcToday()));

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("skipped");
      expect(ingestBodies()).toEqual([]);
    });

    it("still buzzes for a phone that has gone quiet past its window", async () => {
      vi.mocked(getStepsRaw).mockResolvedValue({
        state: "ok",
        value: JSON.stringify({ v: 1, days: { [sydneyDaysAgo(3)]: 8423 } }),
      });
      vi.mocked(getStoredBriefing).mockResolvedValue(briefingFor(utcToday()));

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("written");
      expect(ingestBodies()).toEqual(["steps last posted 3d ago"]);
    });

    it("names every source that has gone quiet, one line each", async () => {
      vi.mocked(getSleepRaw).mockResolvedValue({
        state: "ok",
        value: JSON.stringify({ v: 1, nights: { [sydneyDaysAgo(4)]: 450 } }),
      });
      vi.mocked(getStoredBriefing).mockResolvedValue(
        briefingFor(utcDaysAgo(1)),
      );

      const body = await (await GET(req())).json();
      expect(body.alarm).toBe("written");
      expect(ingestBodies()).toEqual([
        "sleep last posted 4d ago",
        "briefing last posted 1d ago",
      ]);
    });
  });
});
