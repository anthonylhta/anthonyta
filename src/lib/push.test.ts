import { describe, expect, it } from "vitest";
import {
  addSub,
  categoryOn,
  checkStaleness,
  daysBetween,
  EMPTY_PUSH_CONFIG,
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
  stalenessBody,
  STALE_AFTER_DAYS,
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
      categories: { dropbox: true, signin: false, ingest: true },
      episodes: { steps: "2026-08-10" },
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
    const parsed = normalizePushConfig({ categories: { dropbox: false } });
    expect(parsed.categories).toEqual({
      dropbox: false,
      signin: true,
      ingest: true,
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
        sleep: "yesterday",
        other: "2026-01-01",
      },
    });
    expect(parsed.episodes).toEqual({ steps: "2026-08-10" });
  });

  it("caps the device list", () => {
    const many = Array.from({ length: MAX_SUBS + 4 }, (_, i) =>
      sub({ id: `id-${i}`, endpoint: `https://push.example/${i}` }),
    );
    expect(normalizePushConfig({ subs: many }).subs).toHaveLength(MAX_SUBS);
  });

  it("survives a blob whose fields are the wrong types entirely", () => {
    expect(
      normalizePushConfig({ subs: "nope", categories: 7, episodes: [] }),
    ).toEqual(EMPTY_PUSH_CONFIG);
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
      "dropbox",
      "ingest",
      "signin",
    ]);
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

describe("copy and payload", () => {
  it("names the source and the gap, nothing else", () => {
    expect(stalenessBody("steps", 3)).toBe("steps last posted 3d ago");
    expect(stalenessBody("sleep", 11)).toBe("sleep last posted 11d ago");
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
