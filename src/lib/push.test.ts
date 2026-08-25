import { describe, expect, it } from "vitest";
import { type OverdueChore } from "./chores";
import {
  addSub,
  briefingRecordedDays,
  categoryOn,
  checkChoresDigest,
  checkHealthDown,
  checkStaleness,
  choresDigestBody,
  CHORES_DIGEST_DAYS,
  daysBetween,
  EMPTY_PUSH_CONFIG,
  healthDownBody,
  HEALTH_DOWN_NIGHTS,
  isPushSub,
  MAX_SUBS,
  newestRecordedDay,
  normalizePushConfig,
  parsePushConfig,
  pruneSubs,
  pushPayload,
  PUSH_CATEGORIES,
  removeSub,
  sanitizeConfig,
  serializePushConfig,
  setCategory,
  setEpisode,
  setHealth,
  staleAfterDays,
  stalenessBody,
  STALE_AFTER_DAYS,
  utcToday,
  vapidStatus,
  type HealthProbe,
  type PushConfig,
  type PushSub,
} from "./push";

const sub = (over: Partial<PushSub> = {}): PushSub => ({
  id: "id-1",
  endpoint: "https://push.example/abc",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
  label: "linux",
  created: "2026-08-20T09:00:00.000Z",
  ...over,
});

const cfg = (over: Partial<PushConfig> = {}): PushConfig => ({
  ...EMPTY_PUSH_CONFIG,
  ...over,
});

describe("isPushSub", () => {
  it("accepts a well-formed subscription", () => {
    expect(isPushSub(sub())).toBe(true);
  });

  it("rejects anything the server could not actually send to", () => {
    expect(isPushSub(null)).toBe(false);
    expect(isPushSub({ ...sub(), endpoint: "" })).toBe(false);
    expect(isPushSub({ ...sub(), keys: undefined })).toBe(false);
    expect(isPushSub({ ...sub(), keys: { p256dh: "x" } })).toBe(false);
    expect(isPushSub({ ...sub(), keys: { auth: "x" } })).toBe(false);
    expect(isPushSub({ ...sub(), id: "" })).toBe(false);
    expect(isPushSub({ ...sub(), label: "" })).toBe(false);
    expect(isPushSub({ ...sub(), created: "" })).toBe(false);
  });

  it("rejects a non-https endpoint", () => {
    expect(isPushSub({ ...sub(), endpoint: "http://push.example/a" })).toBe(
      false,
    );
    expect(isPushSub({ ...sub(), endpoint: "javascript:alert(1)" })).toBe(
      false,
    );
  });

  it("rejects an endpoint or key past its bound", () => {
    expect(
      isPushSub({ ...sub(), endpoint: `https://x/${"a".repeat(2000)}` }),
    ).toBe(false);
    expect(
      isPushSub({
        ...sub(),
        keys: { p256dh: "a".repeat(500), auth: "b" },
      }),
    ).toBe(false);
  });
});

describe("parsePushConfig", () => {
  it("folds junk to the all-on empty config instead of throwing", () => {
    expect(parsePushConfig("not json")).toEqual(EMPTY_PUSH_CONFIG);
    expect(parsePushConfig("null")).toEqual(EMPTY_PUSH_CONFIG);
    expect(parsePushConfig("[1,2,3]")).toEqual(EMPTY_PUSH_CONFIG);
    expect(parsePushConfig('"a string"')).toEqual(EMPTY_PUSH_CONFIG);
  });

  it("round-trips a real config", () => {
    const source = cfg({
      subs: [sub()],
      categories: {
        dropbox: true,
        signin: false,
        ingest: true,
        share: true,
        chores: true,
        health: true,
      },
      episodes: { steps: "2026-08-10", chores: "2026-08-18" },
      health: { riichi: { fails: 2, told: true } },
    });
    expect(parsePushConfig(serializePushConfig(source))).toEqual(source);
  });

  it("drops malformed subs and keeps the good ones", () => {
    const parsed = normalizePushConfig({
      subs: [
        sub(),
        { id: "bad" },
        sub({ id: "id-2", endpoint: "https://p/2" }),
      ],
    });
    expect(parsed.subs.map((s) => s.id)).toEqual(["id-1", "id-2"]);
  });

  it("collapses duplicate endpoints so a device is never buzzed twice", () => {
    const parsed = normalizePushConfig({
      subs: [sub(), sub({ id: "id-2" })],
    });
    expect(parsed.subs).toHaveLength(1);
    expect(parsed.subs[0].id).toBe("id-1");
  });

  it("defaults a category the blob predates to ON", () => {
    // Exactly the shape a config written before `chores` and `health` existed has.
    const parsed = normalizePushConfig({
      categories: { dropbox: false, signin: true, ingest: true, share: true },
    });
    expect(parsed.categories).toEqual({
      dropbox: false,
      signin: true,
      ingest: true,
      share: true,
      chores: true,
      health: true,
    });
  });

  it("ignores unknown categories and non-boolean values", () => {
    const parsed = normalizePushConfig({
      categories: { dropbox: "yes", nonsense: false },
    });
    expect(parsed.categories).toEqual(EMPTY_PUSH_CONFIG.categories);
  });

  it("keeps only well-formed episode markers", () => {
    const parsed = normalizePushConfig({
      episodes: {
        steps: "2026-08-10",
        chores: "2026-08-18",
        sleep: "yesterday",
        other: "2026-01-01",
      },
    });
    expect(parsed.episodes).toEqual({
      steps: "2026-08-10",
      chores: "2026-08-18",
    });
  });

  it("parses a config written before the briefing was watched, unchanged", () => {
    // The blob already in R2 has no `briefing` marker — absent must read as
    // armed, not as a broken config.
    const parsed = normalizePushConfig({
      v: 1,
      subs: [sub()],
      categories: { ingest: true },
      episodes: { steps: "2026-08-10", sleep: "2026-08-10" },
      health: {},
    });
    expect(parsed.episodes).toEqual({
      steps: "2026-08-10",
      sleep: "2026-08-10",
    });
    expect(parsed.episodes.briefing).toBeUndefined();
    expect(parsed.subs).toHaveLength(1);
  });

  it("keeps a briefing episode marker now that it is a watched source", () => {
    const parsed = normalizePushConfig({
      episodes: { briefing: "2026-08-24" },
    });
    expect(parsed.episodes).toEqual({ briefing: "2026-08-24" });
  });

  it("keeps only live health entries for projects the hub still probes", () => {
    const parsed = normalizePushConfig({
      health: {
        riichi: { fails: 2, told: true },
        novel: { fails: 1, told: false },
        // A project the hub no longer probes cleans itself up.
        retired: { fails: 5, told: true },
      },
    });
    expect(parsed.health).toEqual({
      riichi: { fails: 2, told: true },
      novel: { fails: 1, told: false },
    });
  });

  it("drops a half-formed health entry rather than counting nights off it", () => {
    const parsed = normalizePushConfig({
      health: {
        riichi: { fails: 2 },
        novel: { told: true },
        ishin: { fails: "two", told: true },
      },
    });
    expect(parsed.health).toEqual({});
    expect(
      normalizePushConfig({
        health: { riichi: { fails: 0, told: false } },
      }).health,
    ).toEqual({});
    expect(
      normalizePushConfig({
        health: { riichi: { fails: 1.5, told: false } },
      }).health,
    ).toEqual({});
    expect(normalizePushConfig({ health: { riichi: null } }).health).toEqual(
      {},
    );
  });

  it("caps the device list", () => {
    const many = Array.from({ length: MAX_SUBS + 4 }, (_, i) =>
      sub({ id: `id-${i}`, endpoint: `https://push.example/${i}` }),
    );
    expect(normalizePushConfig({ subs: many }).subs).toHaveLength(MAX_SUBS);
  });

  it("survives a blob whose fields are the wrong types entirely", () => {
    expect(
      normalizePushConfig({
        subs: "nope",
        categories: 7,
        episodes: [],
        health: [],
      }),
    ).toEqual(EMPTY_PUSH_CONFIG);
    expect(normalizePushConfig({ health: "down" })).toEqual(EMPTY_PUSH_CONFIG);
  });
});

describe("subscription bookkeeping", () => {
  it("adds a device", () => {
    expect(addSub(EMPTY_PUSH_CONFIG, sub()).subs).toEqual([sub()]);
  });

  it("refreshes an existing endpoint in place, keeping id and created", () => {
    const before = cfg({ subs: [sub()] });
    const after = addSub(
      before,
      sub({
        id: "fresh-id",
        created: "2027-01-01T00:00:00.000Z",
        label: "android",
      }),
    );
    expect(after.subs).toHaveLength(1);
    expect(after.subs[0].id).toBe("id-1");
    expect(after.subs[0].created).toBe("2026-08-20T09:00:00.000Z");
    expect(after.subs[0].label).toBe("android");
  });

  it("evicts the oldest device at the cap", () => {
    let out = EMPTY_PUSH_CONFIG;
    for (let i = 0; i < MAX_SUBS + 1; i++)
      out = addSub(
        out,
        sub({ id: `id-${i}`, endpoint: `https://push.example/${i}` }),
      );
    expect(out.subs).toHaveLength(MAX_SUBS);
    expect(out.subs[0].id).toBe("id-1");
  });

  it("removes by id, and an unknown id is a no-op", () => {
    const before = cfg({
      subs: [sub(), sub({ id: "id-2", endpoint: "https://p/2" })],
    });
    expect(removeSub(before, "id-1").subs.map((s) => s.id)).toEqual(["id-2"]);
    expect(removeSub(before, "nope").subs).toHaveLength(2);
  });

  it("prunes a set of dead ids in one pass", () => {
    const before = cfg({
      subs: [
        sub(),
        sub({ id: "id-2", endpoint: "https://p/2" }),
        sub({ id: "id-3", endpoint: "https://p/3" }),
      ],
    });
    expect(pruneSubs(before, ["id-1", "id-3"]).subs.map((s) => s.id)).toEqual([
      "id-2",
    ]);
    expect(pruneSubs(before, [])).toBe(before);
  });

  it("does not mutate the config it was handed", () => {
    const before = cfg({ subs: [sub()] });
    removeSub(before, "id-1");
    addSub(before, sub({ id: "id-9", endpoint: "https://p/9" }));
    expect(before.subs).toHaveLength(1);
  });
});

describe("category gating", () => {
  it("is off when nobody is subscribed, whatever the toggle says", () => {
    expect(categoryOn(EMPTY_PUSH_CONFIG, "dropbox")).toBe(false);
  });

  it("is on for a subscribed device with the toggle set", () => {
    const one = cfg({ subs: [sub()] });
    expect(categoryOn(one, "dropbox")).toBe(true);
    expect(categoryOn(setCategory(one, "dropbox", false), "dropbox")).toBe(
      false,
    );
    expect(categoryOn(setCategory(one, "dropbox", false), "signin")).toBe(true);
  });

  it("covers every declared category", () => {
    expect([...PUSH_CATEGORIES].sort()).toEqual([
      "chores",
      "dropbox",
      "health",
      "ingest",
      "share",
      "signin",
    ]);
  });

  it("gates the share alarm like the rest", () => {
    const one = cfg({ subs: [sub()] });
    expect(categoryOn(one, "share")).toBe(true);
    expect(categoryOn(setCategory(one, "share", false), "share")).toBe(false);
    expect(categoryOn(EMPTY_PUSH_CONFIG, "share")).toBe(false);
  });

  it("gates the upkeep digest like the rest", () => {
    const one = cfg({ subs: [sub()] });
    expect(categoryOn(one, "chores")).toBe(true);
    expect(categoryOn(setCategory(one, "chores", false), "chores")).toBe(false);
    expect(categoryOn(EMPTY_PUSH_CONFIG, "chores")).toBe(false);
  });

  it("gates the health tripwire like the rest", () => {
    const one = cfg({ subs: [sub()] });
    expect(categoryOn(one, "health")).toBe(true);
    expect(categoryOn(setCategory(one, "health", false), "health")).toBe(false);
    expect(categoryOn(EMPTY_PUSH_CONFIG, "health")).toBe(false);
  });
});

describe("setEpisode", () => {
  it("records and clears a marker", () => {
    const marked = setEpisode(EMPTY_PUSH_CONFIG, "steps", "2026-08-10");
    expect(marked.episodes).toEqual({ steps: "2026-08-10" });
    expect(setEpisode(marked, "steps", undefined).episodes).toEqual({});
  });

  it("leaves the other source alone", () => {
    const both = setEpisode(
      setEpisode(EMPTY_PUSH_CONFIG, "steps", "2026-08-10"),
      "sleep",
      "2026-08-11",
    );
    expect(setEpisode(both, "steps", undefined).episodes).toEqual({
      sleep: "2026-08-11",
    });
  });

  it("carries the digest marker beside the ingest sources", () => {
    const marked = setEpisode(
      setEpisode(EMPTY_PUSH_CONFIG, "steps", "2026-08-10"),
      "chores",
      "2026-08-18",
    );
    expect(marked.episodes).toEqual({
      steps: "2026-08-10",
      chores: "2026-08-18",
    });
    expect(setEpisode(marked, "chores", undefined).episodes).toEqual({
      steps: "2026-08-10",
    });
  });
});

describe("sanitizeConfig", () => {
  it("hands back ids and labels but never the endpoint or the keys", () => {
    const view = sanitizeConfig(cfg({ subs: [sub()] }));
    expect(view.subs).toEqual([
      { id: "id-1", label: "linux", created: "2026-08-20T09:00:00.000Z" },
    ]);
    expect(JSON.stringify(view)).not.toContain("push.example");
    expect(JSON.stringify(view)).not.toContain("p256dh-key");
    expect(JSON.stringify(view)).not.toContain("auth-key");
  });

  it("copies the toggles rather than aliasing them", () => {
    const source = cfg({ subs: [sub()] });
    const view = sanitizeConfig(source);
    view.categories.dropbox = false;
    expect(source.categories.dropbox).toBe(true);
  });
});

describe("newestRecordedDay / daysBetween", () => {
  it("finds the latest valid day", () => {
    expect(
      newestRecordedDay({ "2026-08-01": 1, "2026-08-19": 2, "2026-08-05": 3 }),
    ).toBe("2026-08-19");
  });

  it("ignores keys that are not days", () => {
    expect(newestRecordedDay({ v: 1, "2026-08-01": 5 })).toBe("2026-08-01");
    expect(newestRecordedDay({})).toBeNull();
    expect(newestRecordedDay({ nonsense: 1 })).toBeNull();
  });

  it("counts whole days across a month and a DST boundary", () => {
    expect(daysBetween("2026-08-19", "2026-08-22")).toBe(3);
    expect(daysBetween("2026-08-22", "2026-08-22")).toBe(0);
    // Sydney leaves DST on 5 April 2026; UTC-midnight math must not drift.
    expect(daysBetween("2026-04-03", "2026-04-07")).toBe(4);
    expect(daysBetween("2026-08-25", "2026-08-22")).toBe(-3);
  });

  it("returns 0 rather than NaN for an unparseable day", () => {
    expect(daysBetween("nope", "2026-08-22")).toBe(0);
  });
});

describe("checkStaleness", () => {
  const today = "2026-08-22";

  it("stays silent and keeps the marker when the store could not be read", () => {
    const out = checkStaleness(null, today, "2026-08-10");
    expect(out).toEqual({
      alarm: false,
      days: 0,
      episode: "2026-08-10",
      reason: "unread",
    });
  });

  it("never arms a store that has never held data", () => {
    const out = checkStaleness({}, today, undefined);
    expect(out.alarm).toBe(false);
    expect(out.reason).toBe("unarmed");
  });

  it("stays quiet inside the window and re-arms", () => {
    for (const day of ["2026-08-22", "2026-08-21", "2026-08-20"]) {
      const out = checkStaleness({ [day]: 1 }, today, "2026-08-01");
      expect(out.alarm).toBe(false);
      expect(out.reason).toBe("fresh");
      expect(out.episode).toBeUndefined();
    }
  });

  it("alarms the first night past the window and records the episode", () => {
    const out = checkStaleness({ "2026-08-19": 8000 }, today, undefined);
    expect(out).toEqual({
      alarm: true,
      days: 3,
      episode: "2026-08-19",
      reason: "stale",
    });
  });

  it("alarms once per silence, not once per night", () => {
    const quiet = { "2026-08-19": 8000 };
    const first = checkStaleness(quiet, today, undefined);
    expect(first.alarm).toBe(true);
    const second = checkStaleness(quiet, "2026-08-23", first.episode);
    expect(second.alarm).toBe(false);
    expect(second.reason).toBe("notified");
    expect(second.episode).toBe("2026-08-19");
  });

  it("re-arms once data resumes, so the next silence alarms again", () => {
    const notified = checkStaleness({ "2026-08-19": 1 }, today, "2026-08-19");
    expect(notified.alarm).toBe(false);

    // The phone posts again on the 23rd…
    const resumed = checkStaleness(
      { "2026-08-19": 1, "2026-08-23": 1 },
      "2026-08-23",
      notified.episode,
    );
    expect(resumed.reason).toBe("fresh");
    expect(resumed.episode).toBeUndefined();

    // …then goes quiet again: a new episode, a new alarm.
    const again = checkStaleness(
      { "2026-08-19": 1, "2026-08-23": 1 },
      "2026-08-27",
      resumed.episode,
    );
    expect(again.alarm).toBe(true);
    expect(again.episode).toBe("2026-08-23");
  });

  it("holds its fire exactly at the boundary", () => {
    const edge = checkStaleness(
      { "2026-08-20": 1 },
      today,
      undefined,
      STALE_AFTER_DAYS,
    );
    expect(edge.days).toBe(2);
    expect(edge.alarm).toBe(false);
  });

  it("honours a custom window", () => {
    expect(checkStaleness({ "2026-08-21": 1 }, today, undefined, 0).alarm).toBe(
      true,
    );
    expect(
      checkStaleness({ "2026-08-10": 1 }, today, undefined, 30).alarm,
    ).toBe(false);
  });

  it("treats a future-dated record as fresh, never as a negative silence", () => {
    const out = checkStaleness({ "2026-09-01": 1 }, today, undefined);
    expect(out.alarm).toBe(false);
    expect(out.reason).toBe("fresh");
  });
});

describe("staleAfterDays", () => {
  it("gives the phone's feeds room for one missed day", () => {
    expect(staleAfterDays("steps")).toBe(STALE_AFTER_DAYS);
    expect(staleAfterDays("sleep")).toBe(STALE_AFTER_DAYS);
  });

  it("gives the briefing none — one skipped morning is the event", () => {
    expect(staleAfterDays("briefing")).toBe(0);
  });
});

describe("utcToday", () => {
  it("reads the UTC calendar day, not the local one", () => {
    // 13:00Z is already the next day in Sydney under AEDT; the UTC day is not.
    expect(utcToday(new Date("2026-01-15T13:00:00.000Z"))).toBe("2026-01-15");
    expect(utcToday(new Date("2026-01-15T23:59:59.000Z"))).toBe("2026-01-15");
    expect(utcToday(new Date("2026-01-16T00:00:00.000Z"))).toBe("2026-01-16");
  });
});

describe("briefingRecordedDays", () => {
  it("reports unread on a store error, never an empty map", () => {
    expect(briefingRecordedDays({ state: "error" })).toBeNull();
  });

  it("reports an empty map when nothing has ever been ingested", () => {
    expect(briefingRecordedDays({ state: "absent" })).toEqual({});
  });

  it("turns the stored day into the single recorded day", () => {
    expect(
      briefingRecordedDays({ state: "ok", value: { date: "2026-08-25" } }),
    ).toEqual({ "2026-08-25": 1 });
  });

  it("stays unarmed on a stamp that is not a day", () => {
    // `isBriefing` only checks `date` is a short label, so junk can be stored —
    // and a malformed stamp must never manufacture an alarm.
    for (const date of [
      "mon 25 aug",
      "",
      "2026-8-5",
      20260825,
      null,
      undefined,
    ])
      expect(briefingRecordedDays({ state: "ok", value: { date } })).toEqual(
        {},
      );
  });
});

describe("checkStaleness — the briefing's zero-day window", () => {
  const window = staleAfterDays("briefing");

  it("is fresh on the morning it lands", () => {
    const out = checkStaleness(
      { "2026-08-25": 1 },
      "2026-08-25",
      undefined,
      window,
    );
    expect(out.reason).toBe("fresh");
    expect(out.alarm).toBe(false);
  });

  it("alarms the same night a morning is skipped", () => {
    const out = checkStaleness(
      { "2026-08-24": 1 },
      "2026-08-25",
      undefined,
      window,
    );
    expect(out).toEqual({
      alarm: true,
      days: 1,
      episode: "2026-08-24",
      reason: "stale",
    });
    expect(stalenessBody("briefing", out.days)).toBe(
      "briefing last posted 1d ago",
    );
  });

  it("says it once, not once a night, while the routine stays quiet", () => {
    const quiet = { "2026-08-24": 1 };
    const first = checkStaleness(quiet, "2026-08-25", undefined, window);
    expect(first.alarm).toBe(true);

    const second = checkStaleness(quiet, "2026-08-26", first.episode, window);
    expect(second.alarm).toBe(false);
    expect(second.reason).toBe("notified");
    expect(second.episode).toBe("2026-08-24");
  });

  it("re-arms the moment a briefing lands again", () => {
    const notified = checkStaleness(
      { "2026-08-24": 1 },
      "2026-08-26",
      "2026-08-24",
      window,
    );
    expect(notified.reason).toBe("notified");

    const landed = checkStaleness(
      { "2026-08-27": 1 },
      "2026-08-27",
      notified.episode,
      window,
    );
    expect(landed.reason).toBe("fresh");
    expect(landed.episode).toBeUndefined();

    // …and the next skipped morning is a new episode, so it buzzes again.
    const again = checkStaleness(
      { "2026-08-27": 1 },
      "2026-08-28",
      landed.episode,
      window,
    );
    expect(again.alarm).toBe(true);
    expect(again.episode).toBe("2026-08-27");
  });
});

describe("copy and payload", () => {
  it("names the source and the gap, nothing else", () => {
    expect(stalenessBody("steps", 3)).toBe("steps last posted 3d ago");
    expect(stalenessBody("sleep", 11)).toBe("sleep last posted 11d ago");
    expect(stalenessBody("briefing", 1)).toBe("briefing last posted 1d ago");
  });

  it("carries only a tag, a line and a destination", () => {
    expect(pushPayload("dropbox", "sealed mail waiting")).toEqual({
      t: "dropbox",
      body: "sealed mail waiting",
      url: "/",
    });
    expect(
      pushPayload("signin", "passkey sign-in · android", "/system").url,
    ).toBe("/system");
  });
});

describe("vapidStatus", () => {
  // Shapes web-push itself accepts: 65 bytes → 87 chars, 32 bytes → 43 chars.
  const pub = "B" + "A".repeat(86);
  const priv = "A".repeat(43);

  it("reads nothing set as the designed off state", () => {
    expect(vapidStatus(undefined, undefined, undefined)).toEqual({
      state: "off",
    });
    expect(vapidStatus("", "", "")).toEqual({ state: "off" });
  });

  it("names the missing var once anything is set", () => {
    expect(vapidStatus(pub, undefined, undefined)).toEqual({
      state: "misconfigured",
      problem: "VAPID_PRIVATE_KEY unset",
    });
    expect(vapidStatus(pub, priv, undefined)).toEqual({
      state: "misconfigured",
      problem: "VAPID_SUBJECT unset",
    });
    expect(vapidStatus(undefined, priv, "mailto:a@b.com")).toEqual({
      state: "misconfigured",
      problem: "VAPID_PUBLIC_KEY unset",
    });
  });

  it("refuses the bare-email subject that killed every send (2026-08-23)", () => {
    const s = vapidStatus(pub, priv, "anthony.ta@live.com");
    expect(s.state).toBe("misconfigured");
    if (s.state === "misconfigured")
      expect(s.problem).toContain("VAPID_SUBJECT");
  });

  it("mirrors web-push's subject rule: https: or mailto: only", () => {
    expect(vapidStatus(pub, priv, "mailto:a@b.com").state).toBe("ok");
    expect(vapidStatus(pub, priv, "https://anthonyta.dev").state).toBe("ok");
    expect(vapidStatus(pub, priv, "http://anthonyta.dev").state).toBe(
      "misconfigured",
    );
    expect(vapidStatus(pub, priv, "not a url").state).toBe("misconfigured");
  });

  it("checks key shape — length and padless base64url charset", () => {
    expect(vapidStatus(pub.slice(1), priv, "mailto:a@b.com").state).toBe(
      "misconfigured",
    );
    expect(vapidStatus(pub, priv + "=", "mailto:a@b.com").state).toBe(
      "misconfigured",
    );
    expect(vapidStatus(pub, "A".repeat(44), "mailto:a@b.com").state).toBe(
      "misconfigured",
    );
  });

  it("hands the panel the public key only when the trio is sendable", () => {
    expect(vapidStatus(pub, priv, "mailto:a@b.com")).toEqual({
      state: "ok",
      publicKey: pub,
    });
  });
});

describe("choresDigestBody", () => {
  it("names each chore, its age and the thing to run", () => {
    expect(
      choresDigestBody([
        { label: "backup", days: 62, command: "npm run hub-backup" },
      ]),
    ).toBe("upkeep overdue — backup 62d (npm run hub-backup)");
  });

  it("joins the whole set into one line", () => {
    expect(
      choresDigestBody([
        { label: "vault-sync", days: 9, command: "npm run vault-sync" },
        { label: "backup", days: 62, command: "npm run hub-backup" },
        { label: "aperture seal", days: 15, command: null },
      ]),
    ).toBe(
      "upkeep overdue — vault-sync 9d (npm run vault-sync) · backup 62d (npm run hub-backup) · aperture seal 15d",
    );
  });
});

describe("checkChoresDigest", () => {
  const red = (days = 62): OverdueChore[] => [
    { label: "backup", days, command: "npm run hub-backup" },
  ];

  it("says nothing when nothing is overdue, and re-arms", () => {
    const out = checkChoresDigest([], "2026-08-23", "2026-08-20");
    expect(out).toEqual({
      send: false,
      body: "",
      episode: undefined,
      reason: "quiet",
    });
  });

  it("sends the first time something is overdue", () => {
    const out = checkChoresDigest(red(), "2026-08-23", undefined);
    expect(out.send).toBe(true);
    expect(out.episode).toBe("2026-08-23");
    expect(out.reason).toBe("overdue");
    expect(out.body).toContain("backup 62d");
  });

  it("stays quiet for the rest of the week, keeping the marker", () => {
    const out = checkChoresDigest(red(), "2026-08-23", "2026-08-18");
    expect(out).toEqual({
      send: false,
      body: "",
      episode: "2026-08-18",
      reason: "notified",
    });
  });

  it("says it again once the window has passed", () => {
    // Exactly CHORES_DIGEST_DAYS on: the window is closed, not still open.
    const out = checkChoresDigest(red(), "2026-08-23", "2026-08-16");
    expect(daysBetween("2026-08-16", "2026-08-23")).toBe(CHORES_DIGEST_DAYS);
    expect(out.send).toBe(true);
    expect(out.episode).toBe("2026-08-23");
  });

  it("re-arms through a quiet night, so the next episode lands at once", () => {
    const cleared = checkChoresDigest([], "2026-08-23", "2026-08-22");
    expect(cleared.episode).toBeUndefined();
    expect(checkChoresDigest(red(), "2026-08-24", cleared.episode).send).toBe(
      true,
    );
  });

  it("does not restart the window when another chore joins the set", () => {
    const two: OverdueChore[] = [
      ...red(),
      { label: "vault-sync", days: 9, command: "npm run vault-sync" },
    ];
    expect(checkChoresDigest(two, "2026-08-23", "2026-08-22").send).toBe(false);
  });
});

describe("setHealth", () => {
  it("replaces the whole map without touching the rest of the config", () => {
    const before = cfg({ subs: [sub()], episodes: { steps: "2026-08-10" } });
    const after = setHealth(before, { riichi: { fails: 1, told: false } });
    expect(after.health).toEqual({ riichi: { fails: 1, told: false } });
    expect(after.subs).toEqual(before.subs);
    expect(after.episodes).toEqual(before.episodes);
    expect(before.health).toEqual({});
  });
});

describe("healthDownBody", () => {
  it("names the project and how long it has been quiet", () => {
    expect(healthDownBody([{ label: "riichi", nights: 2 }])).toBe(
      "riichi down 2 nights",
    );
  });

  it("joins several projects into one line", () => {
    expect(
      healthDownBody([
        { label: "riichi", nights: 2 },
        { label: "ishin", nights: 4 },
      ]),
    ).toBe("riichi down 2 nights · ishin down 4 nights");
  });
});

describe("checkHealthDown", () => {
  const probes = (...down: string[]): HealthProbe[] => [
    { key: "riichi", label: "riichi", down: down.includes("riichi") },
    { key: "novel", label: "webnovel", down: down.includes("novel") },
    { key: "ishin", label: "ishin", down: down.includes("ishin") },
  ];

  it("says nothing and stores nothing when the estate answers", () => {
    expect(checkHealthDown(probes(), {})).toEqual({
      alarm: false,
      body: "",
      health: {},
    });
  });

  it("counts the first failed night without buzzing", () => {
    const out = checkHealthDown(probes("riichi"), {});
    expect(out.alarm).toBe(false);
    expect(out.body).toBe("");
    expect(out.health).toEqual({ riichi: { fails: 1, told: false } });
  });

  it("buzzes on the second consecutive night and marks the episode told", () => {
    const first = checkHealthDown(probes("riichi"), {});
    const second = checkHealthDown(probes("riichi"), first.health);
    expect(second.alarm).toBe(true);
    expect(second.body).toBe("riichi down 2 nights");
    expect(second.health).toEqual({ riichi: { fails: 2, told: true } });
    expect(HEALTH_DOWN_NIGHTS).toBe(2);
  });

  it("stays silent every night after that — a tripwire, not a nag", () => {
    let state = checkHealthDown(probes("riichi"), {}).health;
    state = checkHealthDown(probes("riichi"), state).health;
    for (const nights of [3, 4, 5]) {
      const out = checkHealthDown(probes("riichi"), state);
      expect(out.alarm).toBe(false);
      expect(out.health.riichi).toEqual({ fails: nights, told: true });
      state = out.health;
    }
  });

  it("forgets a project the moment it answers again, silently", () => {
    const down = checkHealthDown(probes("riichi"), {});
    const back = checkHealthDown(probes(), down.health);
    expect(back.alarm).toBe(false);
    expect(back.body).toBe("");
    expect(back.health).toEqual({});
  });

  it("never buzzes for a project that flaps", () => {
    let state: ReturnType<typeof checkHealthDown>["health"] = {};
    for (const tonight of [
      probes("riichi"),
      probes(),
      probes("riichi"),
      probes(),
      probes("riichi"),
    ]) {
      const out = checkHealthDown(tonight, state);
      expect(out.alarm).toBe(false);
      state = out.health;
    }
  });

  it("buzzes again once a recovered project goes down for a new episode", () => {
    let state = checkHealthDown(probes("riichi"), {}).health;
    const told = checkHealthDown(probes("riichi"), state);
    expect(told.alarm).toBe(true);
    state = checkHealthDown(probes(), told.health).health;
    state = checkHealthDown(probes("riichi"), state).health;
    const again = checkHealthDown(probes("riichi"), state);
    expect(again.alarm).toBe(true);
    expect(again.body).toBe("riichi down 2 nights");
  });

  it("names every project that qualifies tonight on one line", () => {
    const first = checkHealthDown(probes("riichi", "ishin"), {});
    expect(first.alarm).toBe(false);
    const second = checkHealthDown(probes("riichi", "ishin"), first.health);
    expect(second.alarm).toBe(true);
    expect(second.body).toBe("riichi down 2 nights · ishin down 2 nights");
    expect(second.health).toEqual({
      riichi: { fails: 2, told: true },
      ishin: { fails: 2, told: true },
    });
  });

  it("leaves an already-told project out of a later project's alarm", () => {
    let state = checkHealthDown(probes("riichi"), {}).health;
    state = checkHealthDown(probes("riichi"), state).health;
    state = checkHealthDown(probes("riichi", "ishin"), state).health;
    const out = checkHealthDown(probes("riichi", "ishin"), state);
    expect(out.body).toBe("ishin down 2 nights");
    expect(out.health.riichi).toEqual({ fails: 4, told: true });
  });

  it("honours a custom threshold", () => {
    expect(checkHealthDown(probes("riichi"), {}, 1).alarm).toBe(true);
    const two = checkHealthDown(probes("riichi"), {}, 3);
    expect(checkHealthDown(probes("riichi"), two.health, 3).alarm).toBe(false);
  });
});
