import { describe, expect, it } from "vitest";
import {
  placementBucket,
  rankLabel,
  sampleTft,
  summarizeTft,
  type RawLeagueEntry,
  type RawMatch,
} from "./tft";

describe("placementBucket", () => {
  it("splits first / top-4 / bottom-4 at the boundaries", () => {
    expect(placementBucket(1)).toBe("first");
    expect(placementBucket(2)).toBe("top4");
    expect(placementBucket(4)).toBe("top4");
    expect(placementBucket(5)).toBe("bottom4");
    expect(placementBucket(8)).toBe("bottom4");
  });
});

describe("rankLabel", () => {
  it("hides the division for an apex tier", () => {
    expect(rankLabel({ tier: "MASTER", division: null, lp: 21 })).toBe(
      "Master · 21 LP",
    );
  });
  it("shows the division below master", () => {
    expect(rankLabel({ tier: "DIAMOND", division: "II", lp: 63 })).toBe(
      "Diamond II · 63 LP",
    );
  });
  it("title-cases a shouty tier", () => {
    expect(rankLabel({ tier: "GOLD", division: "IV", lp: 8 })).toBe(
      "Gold IV · 8 LP",
    );
  });
  it("is 'unranked' with no rank", () => {
    expect(rankLabel(null)).toBe("unranked");
  });
});

describe("summarizeTft", () => {
  const now = Date.parse("2026-07-15T00:00:00Z");
  const ctx = { puuid: "me", riotId: "anthonyta#OCE", now };
  const entry: RawLeagueEntry = {
    queueType: "RANKED_TFT",
    tier: "DIAMOND",
    rank: "II",
    leaguePoints: 63,
    wins: 40,
    losses: 22,
  };

  /** A ranked match the owner played in, unless `puuid` is overridden away. */
  function match(opts: {
    datetime: number;
    placement?: number;
    puuid?: string;
    queue?: number;
    set?: number;
  }): RawMatch {
    return {
      info: {
        game_datetime: opts.datetime,
        queue_id: opts.queue ?? 1100,
        tft_set_number: opts.set ?? 13,
        participants: [
          { puuid: "other-1", placement: 1 },
          { puuid: opts.puuid ?? "me", placement: opts.placement ?? 4 },
          { puuid: "other-2", placement: 8 },
        ],
      },
    };
  }

  it("sorts newest-first input into oldest→newest placements and dates", () => {
    const t1 = Date.parse("2026-07-10T02:00:00Z");
    const t2 = Date.parse("2026-07-12T02:00:00Z");
    const t3 = Date.parse("2026-07-14T02:00:00Z");
    const matches = [
      match({ datetime: t3, placement: 1 }),
      match({ datetime: t2, placement: 5 }),
      match({ datetime: t1, placement: 3 }),
    ];
    const s = summarizeTft(entry, matches, ctx);
    expect(s.placements).toEqual([3, 5, 1]);
    expect(s.matchDates).toEqual([
      new Date(t1).toISOString(),
      new Date(t2).toISOString(),
      new Date(t3).toISOString(),
    ]);
    expect(s.lastPlayedAt).toBe(new Date(t3).toISOString());
    expect(s.setNumber).toBe(13);
    expect(s.riotId).toBe("anthonyta#OCE");
    expect(s.isLive).toBe(true);
  });

  it("rounds the top-4 rate and averages placement", () => {
    const base = Date.parse("2026-07-14T00:00:00Z");
    const matches = [
      match({ datetime: base, placement: 1 }),
      match({ datetime: base - 1000, placement: 5 }),
      match({ datetime: base - 2000, placement: 3 }),
    ];
    const s = summarizeTft(entry, matches, ctx);
    expect(s.top4Rate).toBe(67); // 2 of 3 in the top 4 → round(66.7)
    expect(s.avgPlacement).toBe(3); // (1 + 5 + 3) / 3
  });

  it("excludes non-standard queues (hyper roll 1130)", () => {
    const base = Date.parse("2026-07-14T00:00:00Z");
    const matches = [
      match({ datetime: base, placement: 2, queue: 1100 }),
      match({ datetime: base - 1000, placement: 1, queue: 1130 }),
    ];
    expect(summarizeTft(entry, matches, ctx).placements).toEqual([2]);
  });

  it("accepts queueId as well as queue_id (proxy hedge)", () => {
    const m: RawMatch = {
      info: {
        game_datetime: Date.parse("2026-07-14T00:00:00Z"),
        queueId: 1100,
        tft_set_number: 13,
        participants: [{ puuid: "me", placement: 3 }],
      },
    };
    expect(summarizeTft(entry, [m], ctx).placements).toEqual([3]);
  });

  it("skips matches the owner didn't play in", () => {
    const base = Date.parse("2026-07-14T00:00:00Z");
    const matches = [
      match({ datetime: base, placement: 4 }),
      match({ datetime: base - 1000, placement: 1, puuid: "stranger" }),
    ];
    expect(summarizeTft(entry, matches, ctx).placements).toEqual([4]);
  });

  it("counts only ranked games inside the trailing 7 days", () => {
    const inside = now - 7 * 86_400_000 + 1000;
    const outside = now - 7 * 86_400_000 - 1000;
    const matches = [
      match({ datetime: inside, placement: 2 }),
      match({ datetime: outside, placement: 3 }),
    ];
    expect(summarizeTft(entry, matches, ctx).gamesThisWeek).toBe(1);
  });

  it("takes games-this-set and rank from the league entry", () => {
    const s = summarizeTft(entry, [], ctx);
    expect(s.gamesThisSet).toBe(62); // 40 + 22
    expect(s.rank).toEqual({ tier: "DIAMOND", division: "II", lp: 63 });
  });

  it("nulls the division for an apex-tier league entry", () => {
    const apex: RawLeagueEntry = {
      queueType: "RANKED_TFT",
      tier: "MASTER",
      rank: "I",
      leaguePoints: 21,
      wins: 100,
      losses: 90,
    };
    expect(summarizeTft(apex, [], ctx).rank).toEqual({
      tier: "MASTER",
      division: null,
      lp: 21,
    });
  });

  it("leaves rate/average null with no ranked games", () => {
    const s = summarizeTft(entry, [], ctx);
    expect(s.top4Rate).toBeNull();
    expect(s.avgPlacement).toBeNull();
    expect(s.placements).toEqual([]);
    expect(s.matchDates).toEqual([]);
    expect(s.lastPlayedAt).toBeNull();
    expect(s.setNumber).toBeNull();
  });

  it("computes match stats when the league read failed (entry null)", () => {
    const base = Date.parse("2026-07-14T00:00:00Z");
    const matches = [
      match({ datetime: base, placement: 2 }),
      match({ datetime: base - 1000, placement: 4 }),
    ];
    const s = summarizeTft(null, matches, ctx);
    expect(s.rank).toBeNull();
    expect(s.gamesThisSet).toBeNull();
    expect(s.placements).toEqual([4, 2]); // oldest → newest
    expect(s.top4Rate).toBe(100);
    expect(s.avgPlacement).toBe(3); // (2 + 4) / 2
  });
});

describe("sampleTft", () => {
  it("has a top-4 rate and average consistent with its placements", () => {
    const p = sampleTft.placements;
    const top4 = p.filter((x) => x <= 4).length;
    const avg = Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 10) / 10;
    expect(sampleTft.top4Rate).toBe(Math.round((100 * top4) / p.length));
    expect(sampleTft.avgPlacement).toBe(avg);
  });
  it("is a static, clock-free sample", () => {
    expect(sampleTft.isLive).toBe(false);
    expect(sampleTft.matchDates).toEqual([]);
    expect(sampleTft.lastPlayedAt).toBeNull();
  });
});
