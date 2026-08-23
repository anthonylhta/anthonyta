/**
 * push — the pure spine of owner-only Web Push (roadmap: the hub taps my
 * shoulder). Config parse/validate, subscription bookkeeping, category gating,
 * and the ingest-staleness predicate. No I/O, no `web-push`, no `next` import,
 * so every rule here is unit-pinned and the impure half (lib/pushsend) stays a
 * thin adapter.
 *
 * PLAINTEXT BY NECESSITY, and it is worth being blunt about why: a push is sent
 * BY the server, so the server must hold the endpoint and the two subscription
 * keys in the clear — there is no arrangement in which a sealed subscription can
 * be delivered to. This is the same ruling as `meta/layout.json` (the lobby
 * layout is public anyway) rather than a softening of the E2EE boundary: what
 * leaks is the fact that a device subscribed and a browser-vendor endpoint, and
 * the payloads themselves stay deliberately contentless ("sealed mail waiting",
 * never the message). Nothing sealed is ever put in a notification.
 */

import { type OverdueChore } from "./chores";

/** The things the hub is allowed to interrupt the owner for. */
export type PushCategory = "dropbox" | "signin" | "ingest" | "share" | "chores";

export const PUSH_CATEGORIES: readonly PushCategory[] = [
  "dropbox",
  "signin",
  "ingest",
  "share",
  "chores",
];

/** The plaintext ingest sources the staleness alarm watches. */
export type IngestSource = "steps" | "sleep";

export const INGEST_SOURCES: readonly IngestSource[] = ["steps", "sleep"];

/** What the episodes map may be keyed by: one marker per ingest source, plus the
 *  maintenance digest's own. Two different meanings share the map (see
 *  `PushConfig.episodes`), but both are a day and both answer "have I said this
 *  already", so they share the bookkeeping. */
export type EpisodeKey = IngestSource | "chores";

export const EPISODE_KEYS: readonly EpisodeKey[] = [
  ...INGEST_SOURCES,
  "chores",
];

/** One subscribed device, exactly as the Push API hands it over. */
export interface PushSub {
  /** A server-minted id — the handle the /system panel removes by. */
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Cosmetic device name (a platform sniff), never trusted. */
  label: string;
  /** ISO instant the device subscribed. */
  created: string;
}

export interface PushConfig {
  v: 1;
  subs: PushSub[];
  categories: Record<PushCategory, boolean>;
  /**
   * Episode bookkeeping for the two nightly alarms — a day per key, absent =
   * armed (the next qualifying night notifies). The key names which alarm, and
   * the two read their day differently:
   *
   *  - an ingest source (`steps`, `sleep`) stores the newest recorded day the
   *    owner has ALREADY been told about — the episode's identity, so a source
   *    that starts posting again and stops later is a new episode
   *    (`checkStaleness`).
   *  - `chores` stores the day the maintenance digest was last SENT, because
   *    overdue upkeep has no episode identity — it just stays overdue, and the
   *    marker is what keeps a nightly job from saying so nightly
   *    (`checkChoresDigest`).
   */
  episodes: Partial<Record<EpisodeKey, string>>;
}

/** Devices kept. A single owner with a phone, a laptop and a spare is the whole
 *  population; the cap only stops a subscribe loop from growing the blob. */
export const MAX_SUBS = 8;

/** Body cap for the route's writes — MAX_SUBS endpoints plus toggles is ~4KB. */
export const PUSH_MAX_BYTES = 16_384;

/** A device is silent for this many days before the ingest alarm fires. */
export const STALE_AFTER_DAYS = 2;

/** How long overdue upkeep gets to stay overdue before it is mentioned again. */
export const CHORES_DIGEST_DAYS = 7;

/** Endpoints are URLs from a browser vendor's push service; bound the length. */
const MAX_ENDPOINT_CHARS = 1024;
const MAX_KEY_CHARS = 256;
const MAX_LABEL_CHARS = 64;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The all-on, nobody-subscribed starting point — also what an absent or
 *  unreadable blob folds to, so the panel always has something editable. */
export const EMPTY_PUSH_CONFIG: PushConfig = {
  v: 1,
  subs: [],
  categories: {
    dropbox: true,
    signin: true,
    ingest: true,
    share: true,
    chores: true,
  },
  episodes: {},
};

/**
 * How the VAPID env trio reads. "off" is the designed absent state (CI, local
 * dev, a fresh deploy). "misconfigured" is the state this type exists for: a
 * value is set but web-push would refuse it at `setVapidDetails`, so every send
 * dies while the panel looks healthy — the 2026-08-23 silent-phone bug, where a
 * bare email in VAPID_SUBJECT hid behind a presence-only gate for a day. "ok"
 * carries the public key the panel subscribes with.
 */
export type VapidStatus =
  | { state: "off" }
  | { state: "misconfigured"; problem: string }
  | { state: "ok"; publicKey: string };

/** Padless base64url of an exact byte count encodes to an exact char count
 *  (65 → 87, 32 → 43), so key shape is judged without decoding. */
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function isB64urlOfBytes(s: string, bytes: number): boolean {
  return B64URL_RE.test(s) && s.length === Math.ceil((bytes * 4) / 3);
}

/** Exactly web-push's `validateSubject` rule: must parse as a URL whose
 *  protocol is https: or mailto:. A bare email fails `new URL` outright. */
function isVapidSubject(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * Judge the trio's SHAPE, not just presence, mirroring the checks web-push
 * runs at `setVapidDetails` (subject protocol; 65-/32-byte padless base64url
 * keys). The mirror must never be STRICTER than web-push — refusing a trio the
 * library would accept invents an outage — so each rule is pinned to the
 * installed validator, and the send path keeps its own try/catch as the
 * backstop for anything subtler. Nothing set at all is the designed off state;
 * once anything is set, silence would be a lie, so the first fault is named.
 */
export function vapidStatus(
  pub: string | undefined,
  priv: string | undefined,
  subject: string | undefined,
): VapidStatus {
  if (!pub && !priv && !subject) return { state: "off" };
  const bad = (problem: string): VapidStatus => ({
    state: "misconfigured",
    problem,
  });
  if (!pub) return bad("VAPID_PUBLIC_KEY unset");
  if (!priv) return bad("VAPID_PRIVATE_KEY unset");
  if (!subject) return bad("VAPID_SUBJECT unset");
  if (!isB64urlOfBytes(pub, 65))
    return bad(
      "VAPID_PUBLIC_KEY malformed — need 65 bytes of padless base64url",
    );
  if (!isB64urlOfBytes(priv, 32))
    return bad(
      "VAPID_PRIVATE_KEY malformed — need 32 bytes of padless base64url",
    );
  if (!isVapidSubject(subject))
    return bad("VAPID_SUBJECT must be a mailto: address or https: URL");
  return { state: "ok", publicKey: pub };
}

function isCategory(x: unknown): x is PushCategory {
  return typeof x === "string" && PUSH_CATEGORIES.includes(x as PushCategory);
}

function str(x: unknown, max: number): string | null {
  return typeof x === "string" && x.length > 0 && x.length <= max ? x : null;
}

/** Validate one subscription entry — a device the server could actually send to.
 *  Anything short of that is dropped rather than repaired: a half-formed
 *  subscription is a send that fails every night forever. */
export function isPushSub(x: unknown): x is PushSub {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (str(o.id, 64) === null) return false;
  const endpoint = str(o.endpoint, MAX_ENDPOINT_CHARS);
  if (endpoint === null) return false;
  if (!endpoint.startsWith("https://")) return false;
  if (typeof o.keys !== "object" || o.keys === null) return false;
  const keys = o.keys as Record<string, unknown>;
  if (str(keys.p256dh, MAX_KEY_CHARS) === null) return false;
  if (str(keys.auth, MAX_KEY_CHARS) === null) return false;
  if (str(o.label, MAX_LABEL_CHARS) === null) return false;
  if (str(o.created, 40) === null) return false;
  return true;
}

/**
 * Parse the stored JSON into a clean config — bad entries dropped, NEVER throws.
 * A garbled blob degrades to the all-on empty config rather than an error: the
 * /system panel is the only writer and rebuilds it in one tap, so there is no
 * re-seed hazard to preserve (the layout store's reasoning, not the vault's).
 */
export function parsePushConfig(json: string): PushConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return EMPTY_PUSH_CONFIG;
  }
  return normalizePushConfig(raw);
}

/** The same cleaning applied to an already-parsed value (the route's PUT body). */
export function normalizePushConfig(raw: unknown): PushConfig {
  if (typeof raw !== "object" || raw === null) return EMPTY_PUSH_CONFIG;
  const o = raw as Record<string, unknown>;

  const subs: PushSub[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.subs)) {
    for (const entry of o.subs) {
      if (!isPushSub(entry)) continue;
      // One row per endpoint: a re-subscribe on the same device must replace,
      // not duplicate, or every send doubles.
      if (seen.has(entry.endpoint)) continue;
      seen.add(entry.endpoint);
      subs.push({
        id: entry.id,
        endpoint: entry.endpoint,
        keys: { p256dh: entry.keys.p256dh, auth: entry.keys.auth },
        label: entry.label,
        created: entry.created,
      });
    }
  }

  // A category absent from the blob defaults ON: a config written before a
  // category existed must not silently mute it (the layout store's
  // new-modules-ship-visible rule).
  const categories = { ...EMPTY_PUSH_CONFIG.categories };
  if (typeof o.categories === "object" && o.categories !== null) {
    for (const [k, v] of Object.entries(
      o.categories as Record<string, unknown>,
    ))
      if (isCategory(k) && typeof v === "boolean") categories[k] = v;
  }

  const episodes: PushConfig["episodes"] = {};
  if (typeof o.episodes === "object" && o.episodes !== null) {
    for (const [k, v] of Object.entries(o.episodes as Record<string, unknown>))
      if (
        EPISODE_KEYS.includes(k as EpisodeKey) &&
        typeof v === "string" &&
        DATE_RE.test(v)
      )
        episodes[k as EpisodeKey] = v;
  }

  return { v: 1, subs: subs.slice(0, MAX_SUBS), categories, episodes };
}

/** Serialize for storage (a stable, versioned shape). */
export function serializePushConfig(cfg: PushConfig): string {
  return JSON.stringify({
    v: 1,
    subs: cfg.subs,
    categories: cfg.categories,
    episodes: cfg.episodes,
  });
}

/**
 * Add (or refresh) one device. Keyed by ENDPOINT, not id: a browser hands out a
 * new subscription object on re-permission but often the same endpoint, and two
 * rows for one device means two buzzes. The refreshed row keeps its place in the
 * list so `created` reads as "first enrolled here". Oldest rows are evicted at
 * the cap.
 */
export function addSub(cfg: PushConfig, sub: PushSub): PushConfig {
  const existing = cfg.subs.findIndex((s) => s.endpoint === sub.endpoint);
  if (existing >= 0) {
    const subs = cfg.subs.slice();
    subs[existing] = {
      ...sub,
      id: subs[existing].id,
      created: subs[existing].created,
    };
    return { ...cfg, subs };
  }
  return { ...cfg, subs: [...cfg.subs, sub].slice(-MAX_SUBS) };
}

/** Drop one device by id. Absent id = no-op (the panel's remove is idempotent). */
export function removeSub(cfg: PushConfig, id: string): PushConfig {
  return { ...cfg, subs: cfg.subs.filter((s) => s.id !== id) };
}

/** Drop several devices at once — the send path's prune of dead endpoints. */
export function pruneSubs(cfg: PushConfig, ids: readonly string[]): PushConfig {
  if (ids.length === 0) return cfg;
  const gone = new Set(ids);
  return { ...cfg, subs: cfg.subs.filter((s) => !gone.has(s.id)) };
}

/** Flip one category toggle. */
export function setCategory(
  cfg: PushConfig,
  category: PushCategory,
  on: boolean,
): PushConfig {
  return { ...cfg, categories: { ...cfg.categories, [category]: on } };
}

/** Is this category allowed to interrupt — and is there anyone to interrupt? */
export function categoryOn(cfg: PushConfig, category: PushCategory): boolean {
  return cfg.categories[category] === true && cfg.subs.length > 0;
}

/** Record (or clear, with `undefined`) one alarm's episode marker. */
export function setEpisode(
  cfg: PushConfig,
  key: EpisodeKey,
  day: string | undefined,
): PushConfig {
  const episodes = { ...cfg.episodes };
  if (day === undefined) delete episodes[key];
  else episodes[key] = day;
  return { ...cfg, episodes };
}

/** What the owner-gated route is allowed to hand back: NEVER the endpoint or the
 *  subscription keys — the panel only needs to name a device and remove it. */
export interface PushView {
  subs: { id: string; label: string; created: string }[];
  categories: Record<PushCategory, boolean>;
}

export function sanitizeConfig(cfg: PushConfig): PushView {
  return {
    subs: cfg.subs.map((s) => ({
      id: s.id,
      label: s.label,
      created: s.created,
    })),
    categories: { ...cfg.categories },
  };
}

// ---------------------------------------------------------------------------
// The ingest-staleness predicate
// ---------------------------------------------------------------------------

/** The newest recorded day in a plaintext daily map, or null when there is none.
 *  ISO dates sort lexicographically = chronologically, so max is a plain sort. */
export function newestRecordedDay(
  recorded: Record<string, unknown>,
): string | null {
  let best: string | null = null;
  for (const day of Object.keys(recorded))
    if (DATE_RE.test(day) && (best === null || day > best)) best = day;
  return best;
}

/** Whole days from `from` to `to` (UTC-midnight math, DST-safe — the sleep.ts
 *  arithmetic). Negative when `from` is in the future. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export interface StalenessResult {
  /** Send the alarm? */
  alarm: boolean;
  /** Days since the newest recorded day — only meaningful when `alarm`. */
  days: number;
  /** The marker this source should carry after the check; `undefined` = re-armed. */
  episode: string | undefined;
  reason: "unread" | "unarmed" | "fresh" | "notified" | "stale";
}

/**
 * Decide whether one ingest source has gone quiet, and keep the once-per-episode
 * bookkeeping. Four rulings, in order, and the first three are all silence:
 *
 *  - `unread`  — the store could not be read (off, or a flake). NEVER alarm off
 *                an error: "I can't see the data" is not "the phone stopped
 *                posting", and a nightly cron that confuses the two cries wolf
 *                every time R2 hiccups. The marker rides through untouched.
 *  - `unarmed` — the store is genuinely empty. A source that has NEVER had data
 *                is not silent, it is unconfigured; the alarm arms itself at the
 *                first datum, so wiring the phone later is not preceded by a week
 *                of complaints.
 *  - `fresh`   — data within the window. This also RE-ARMS: the marker is cleared,
 *                so the next silence is a new episode and does notify.
 *  - stale     — the newest recorded day IS the episode's identity. Told about it
 *                already (`notified`)? Stay quiet — one buzz per silence, not one
 *                per night. Otherwise alarm and record it.
 *
 * `recorded` is null for the unread case; the caller never has to remember to
 * special-case it.
 */
export function checkStaleness(
  recorded: Record<string, unknown> | null,
  today: string,
  lastEpisode: string | undefined,
  staleAfterDays = STALE_AFTER_DAYS,
): StalenessResult {
  if (recorded === null)
    return { alarm: false, days: 0, episode: lastEpisode, reason: "unread" };

  const newest = newestRecordedDay(recorded);
  if (newest === null)
    return { alarm: false, days: 0, episode: lastEpisode, reason: "unarmed" };

  const days = daysBetween(newest, today);
  if (days <= staleAfterDays)
    return { alarm: false, days, episode: undefined, reason: "fresh" };

  if (lastEpisode === newest)
    return { alarm: false, days, episode: newest, reason: "notified" };

  return { alarm: true, days, episode: newest, reason: "stale" };
}

/** The lock-screen line for a silent source — a count, never a diagnosis. */
export function stalenessBody(source: IngestSource, days: number): string {
  return `${source} last posted ${days}d ago`;
}

// ---------------------------------------------------------------------------
// The maintenance digest
// ---------------------------------------------------------------------------

export interface DigestResult {
  /** Send the digest? */
  send: boolean;
  /** The line to send; empty unless `send`. */
  body: string;
  /** The marker the `chores` key should carry after the check; `undefined` = re-armed. */
  episode: string | undefined;
  reason: "quiet" | "notified" | "overdue";
}

/**
 * One line naming every chore that is currently well behind, with the thing to
 * run beside it. Deliberately one notification for the set rather than one each:
 * upkeep tends to slip together (a fortnight away and all three are red), and
 * three buzzes for one neglected week is how a useful alarm gets muted.
 */
export function choresDigestBody(overdue: readonly OverdueChore[]): string {
  const parts = overdue.map(
    (c) => `${c.label} ${c.days}d${c.command ? ` (${c.command})` : ""}`,
  );
  return `upkeep overdue — ${parts.join(" · ")}`;
}

/**
 * Decide whether tonight is a night to mention the overdue upkeep, and keep the
 * marker that stops it becoming a nightly nag. Three rulings:
 *
 *  - `quiet`    — nothing is red. This also RE-ARMS by clearing the marker, so
 *                 the next time something goes overdue it is said at once
 *                 instead of waiting out the previous episode's week.
 *  - `notified` — something is red but it was mentioned inside the window. Stay
 *                 quiet and keep the existing marker: overdue upkeep has no end
 *                 of its own, so without this the same line lands every night
 *                 until it is done, which teaches the owner to ignore it.
 *  - `overdue`  — say it, and stamp today.
 *
 * The set of red chores deliberately does NOT affect the window: a fourth chore
 * going red mid-week waits for the next digest rather than earning its own buzz.
 */
export function checkChoresDigest(
  overdue: readonly OverdueChore[],
  today: string,
  lastSent: string | undefined,
  everyDays = CHORES_DIGEST_DAYS,
): DigestResult {
  if (overdue.length === 0)
    return { send: false, body: "", episode: undefined, reason: "quiet" };

  if (lastSent !== undefined && daysBetween(lastSent, today) < everyDays)
    return { send: false, body: "", episode: lastSent, reason: "notified" };

  return {
    send: true,
    body: choresDigestBody(overdue),
    episode: today,
    reason: "overdue",
  };
}

// ---------------------------------------------------------------------------
// The wire payload
// ---------------------------------------------------------------------------

/**
 * What the service worker receives. Deliberately spare — a category tag, one
 * short line, and where a tap should land. Push payloads are aes128gcm-encrypted
 * end to end, but they also surface on a lock screen and pass through a browser
 * vendor's push service, so detail is withheld on both counts.
 */
export interface PushPayload {
  t: PushCategory;
  body: string;
  url: string;
}

export function pushPayload(
  t: PushCategory,
  body: string,
  url = "/",
): PushPayload {
  return { t, body, url };
}
