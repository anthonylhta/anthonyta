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

/** The three things the hub is allowed to interrupt the owner for. */
export type PushCategory = "dropbox" | "signin" | "ingest";

export const PUSH_CATEGORIES: readonly PushCategory[] = [
  "dropbox",
  "signin",
  "ingest",
];

/** The plaintext ingest sources the staleness alarm watches. */
export type IngestSource = "steps" | "sleep";

export const INGEST_SOURCES: readonly IngestSource[] = ["steps", "sleep"];

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
   * Per-source episode bookkeeping for the ingest alarm: the newest recorded day
   * the owner has ALREADY been told about. Absent = armed (a fresh silence would
   * notify). See `checkStaleness`.
   */
  episodes: Partial<Record<IngestSource, string>>;
}

/** Devices kept. A single owner with a phone, a laptop and a spare is the whole
 *  population; the cap only stops a subscribe loop from growing the blob. */
export const MAX_SUBS = 8;

/** Body cap for the route's writes — MAX_SUBS endpoints plus toggles is ~4KB. */
export const PUSH_MAX_BYTES = 16_384;

/** A device is silent for this many days before the ingest alarm fires. */
export const STALE_AFTER_DAYS = 2;

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
  categories: { dropbox: true, signin: true, ingest: true },
  episodes: {},
};

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
        INGEST_SOURCES.includes(k as IngestSource) &&
        typeof v === "string" &&
        DATE_RE.test(v)
      )
        episodes[k as IngestSource] = v;
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

/** Record (or clear, with `undefined`) one source's episode marker. */
export function setEpisode(
  cfg: PushConfig,
  source: IngestSource,
  day: string | undefined,
): PushConfig {
  const episodes = { ...cfg.episodes };
  if (day === undefined) delete episodes[source];
  else episodes[source] = day;
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
