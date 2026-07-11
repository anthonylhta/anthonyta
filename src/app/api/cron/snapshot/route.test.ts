import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPortfolio } from "@/lib/connectors/portfolio";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import { authorizeCron } from "@/lib/cron-auth";
import {
  boxOpen,
  generateBoxKeypair,
  importBoxPriv,
  toB64url,
} from "@/lib/crypto";
import { isSnapBoxPayload, isSnapIndex, sydneyToday } from "@/lib/fin";
import {
  getSnapIndex,
  getSnapkey,
  putSnapIndex,
  writeSnapBox,
} from "@/lib/finstore";
import { sweepExpiredShares } from "@/lib/shares";
import { GET } from "./route";

// The cron gates on `authorizeCron`, never `auth` — mock the gate to open (null) or
// short-circuit with a 401. The finstore and the two data connectors are the route's
// only other collaborators; crypto + fin run FOR REAL so the seal proof is genuine.
vi.mock("@/lib/cron-auth", () => ({ authorizeCron: vi.fn() }));
vi.mock("@/lib/finstore", () => ({
  getSnapkey: vi.fn(),
  getSnapIndex: vi.fn(),
  putSnapIndex: vi.fn(),
  writeSnapBox: vi.fn(),
}));
vi.mock("@/lib/connectors/portfolio", () => ({ getPortfolio: vi.fn() }));
vi.mock("@/lib/connectors/webnovel", () => ({ getCurrentlyReading: vi.fn() }));
vi.mock("@/lib/shares", () => ({ sweepExpiredShares: vi.fn() }));

const req = () => new Request("http://localhost/api/cron/snapshot");

/** A LIVE portfolio (non-null) whose invested total is `value` AUD. */
function livePortfolio(value: number) {
  return {
    asOf: "",
    holdings: [],
    totals: { value, cost: 0, dayGain: 0, pnl: 0, pnlPct: 0 },
  };
}

/** One currently-reading row at `chapter`. */
function reading(chapter: number) {
  return {
    title: "t",
    chapter,
    total: null,
    updatedAt: "2026-07-09T00:00:00Z",
  };
}

/** A snapkey JSON string that passes `isSnapkey`, sealing to `pubRaw`. */
function snapkeyJson(pubRaw: Uint8Array) {
  return JSON.stringify({
    v: 1,
    alg: "ECDH-P256",
    pub_b64: toB64url(pubRaw),
    sealed_priv_b64: "x",
  });
}

describe("snapshot cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeCron).mockReturnValue(null); // authorized
    vi.mocked(getPortfolio).mockResolvedValue(null); // sample fallback by default
    vi.mocked(getCurrentlyReading).mockResolvedValue([reading(7)]);
    vi.mocked(getSnapkey).mockResolvedValue({ state: "absent" });
    vi.mocked(getSnapIndex).mockResolvedValue({ state: "absent" });
    vi.mocked(putSnapIndex).mockResolvedValue(true);
    vi.mocked(writeSnapBox).mockResolvedValue(true);
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
    expect(getPortfolio).not.toHaveBeenCalled();
    expect(getCurrentlyReading).not.toHaveBeenCalled();
    expect(getSnapkey).not.toHaveBeenCalled();
    expect(getSnapIndex).not.toHaveBeenCalled();
    expect(writeSnapBox).not.toHaveBeenCalled();
    expect(putSnapIndex).not.toHaveBeenCalled();
    expect(sweepExpiredShares).not.toHaveBeenCalled();
  });

  it("seals the invested figure so only the owner's private key can open it", async () => {
    const { pubRaw, privPkcs8 } = await generateBoxKeypair();
    vi.mocked(getSnapkey).mockResolvedValue({
      state: "ok",
      value: snapkeyJson(pubRaw),
    });
    vi.mocked(getPortfolio).mockResolvedValue(livePortfolio(8065.05));

    const res = await GET(req());
    const body = await res.json();
    expect(body.box).toBe("written");

    // Capture the exact ciphertext the cron handed the store and open it with the
    // private half the cron never held.
    const [date, box] = vi.mocked(writeSnapBox).mock.calls[0];
    const priv = await importBoxPriv(privPkcs8);
    const opened = await boxOpen(priv, pubRaw, box);
    const payload = JSON.parse(new TextDecoder().decode(opened));

    expect(isSnapBoxPayload(payload)).toBe(true);
    expect(payload.investedCents).toBe(806505);
    expect(payload.date).toBe(date);
    expect(payload.date).toBe(sydneyToday());
  });

  it("skips the box when the owner hasn't enabled history; the index still writes", async () => {
    vi.mocked(getPortfolio).mockResolvedValue(livePortfolio(1000));
    vi.mocked(getSnapkey).mockResolvedValue({ state: "absent" });

    const body = await (await GET(req())).json();
    expect(body.box).toBe("skipped");
    expect(writeSnapBox).not.toHaveBeenCalled();
    expect(body.index).toBe("written");
    expect(putSnapIndex).toHaveBeenCalledTimes(1);
  });

  it("fails the box on a snapkey store flake and writes no box", async () => {
    vi.mocked(getPortfolio).mockResolvedValue(livePortfolio(1000));
    vi.mocked(getSnapkey).mockResolvedValue({ state: "error" });

    const body = await (await GET(req())).json();
    expect(body.box).toBe("failed");
    expect(writeSnapBox).not.toHaveBeenCalled();
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
    vi.mocked(sweepExpiredShares).mockRejectedValue(new Error("blob flake"));
    vi.mocked(getPortfolio).mockResolvedValue(livePortfolio(1000));

    const body = await (await GET(req())).json();
    expect(body.swept).toBe(-1);
    // The snapshot's own outcomes are unaffected — the sweep is fully independent.
    expect(body.index).toBe("written");
  });
});
