/**
 * Attack corpus + route manifest — the pure spine of the adversarial e2e suite
 * (attacks.spec.ts). No Playwright import, no I/O: every export here is either
 * plain data or a deterministic builder, so `attack-corpus.vitest.ts` can pin the
 * contents under `npm run test`. The corpus IS a spec — it should change
 * deliberately, in review, and the unit tests fail the build if it drifts by
 * accident.
 *
 * Why pin a corpus? The house style collapses every hostile input to the same 404
 * so a prober learns nothing. That uniformity is only as good as the inputs it was
 * proven against. Freezing the input set here — traversal spellings, envelope fuzz,
 * method matrix, header spoofs — turns "the author thought of these cases" into "CI
 * runs these cases against every surface on every build".
 */

// ---------------------------------------------------------------------------
// Route manifest
// ---------------------------------------------------------------------------

/**
 * The response contract a route presents to a GUEST. The suite drives its battery
 * off these shapes, and the completeness check diffs the manifest's `routeKey`s
 * against the app's actual route tree — so a new route that isn't registered here
 * fails a test rather than silently escaping the battery.
 *
 * - `owner-api`      — a route.ts behind `auth()`; a guest gets a byte-identical
 *                      `404 "Not found"`, whatever the input (the ADR 0022 wall).
 * - `owner-page`     — a page.tsx that calls `notFound()` for a guest; same 404
 *                      status, but the body is Next's HTML 404 (a per-request nonce
 *                      rides in it, so bodies aren't byte-compared — headers are).
 * - `public-inert`   — a public recorder (`/api/hit`, `/api/csp-report`) that
 *                      answers an empty `204` to EVERYTHING, so it can't be an
 *                      oracle.
 * - `public-serving` — deliberately reachable by a stranger (share serve, dropbox
 *                      ingest/pubkey, passkey auth-options, every public page). NOT
 *                      404-walled by design; the reason is recorded per entry.
 * - `auth-handler`   — the Auth.js catch-all; its own redirect/JSON contract.
 * - `cron`           — machine endpoint, `401` (not 404) when unauthenticated; it
 *                      is not a hidden surface, it is a locked one.
 */
export type Shape =
  | "owner-api"
  | "owner-page"
  | "public-inert"
  | "public-serving"
  | "auth-handler"
  | "cron";

export type Method =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface RouteEntry {
  /**
   * The route as the filesystem spells it — dynamic segments kept literally
   * (`[id]`, `[...nextauth]`). This is what the completeness check derives from
   * `src/app/**` and diffs against, so it MUST match the on-disk path exactly.
   */
  routeKey: string;
  /** A concrete path to hit (dynamic segments filled, query added where the handler reads one). */
  probe: string;
  shape: Shape;
  /**
   * The methods with REAL handlers (excludes framework-auto `OPTIONS`, and `HEAD`
   * which Next derives from `GET`). Drives the method matrix: any other verb that
   * comes back as a non-405 success is an accidental handler — a finding.
   */
  methods: Method[];
  /** Why a shape departs from the 404 wall — required for every non-owner entry. */
  note?: string;
}

// A far-future expiry + a well-formed 22-char b64url id: the share/`/s` shape that
// passes `parseShareSegment` but resolves to no blob (the store is off in CI), so
// the serve route 404s without becoming an existence oracle.
const SHARE_SEG = `1900000000-e-${"A".repeat(22)}`;

/**
 * Every route in `src/app`. Kept in filesystem order within each group so a diff
 * against the tree reads cleanly. The completeness check (attacks.spec.ts) guarantees
 * this list is exhaustive — you cannot add a route.ts/page.tsx without registering it.
 */
export const ROUTE_MANIFEST: RouteEntry[] = [
  // -- owner-gated API (guest → byte-identical 404 "Not found") -----------------
  {
    routeKey: "/api/auth/webauthn/creds",
    probe: "/api/auth/webauthn/creds",
    shape: "owner-api",
    methods: ["GET", "DELETE"],
  },
  {
    routeKey: "/api/auth/webauthn/register-options",
    probe: "/api/auth/webauthn/register-options",
    shape: "owner-api",
    methods: ["POST"],
  },
  {
    routeKey: "/api/auth/webauthn/register-verify",
    probe: "/api/auth/webauthn/register-verify",
    shape: "owner-api",
    methods: ["POST"],
  },
  {
    routeKey: "/api/dropbox/delete",
    probe: "/api/dropbox/delete",
    shape: "owner-api",
    methods: ["POST"],
  },
  {
    routeKey: "/api/dropbox/key",
    probe: "/api/dropbox/key",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/dropbox/list",
    probe: "/api/dropbox/list",
    shape: "owner-api",
    methods: ["GET"],
  },
  {
    routeKey: "/api/files/delete",
    probe: "/api/files/delete",
    shape: "owner-api",
    methods: ["POST"],
  },
  {
    routeKey: "/api/files/dl",
    probe: "/api/files/dl?p=inbox%2Fx.jpg",
    shape: "owner-api",
    methods: ["GET"],
  },
  {
    routeKey: "/api/files/keystore",
    probe: "/api/files/keystore",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/files/raw",
    probe: "/api/files/raw?p=inbox%2Fx.bin",
    shape: "owner-api",
    methods: ["GET"],
  },
  {
    routeKey: "/api/files/upload",
    probe: "/api/files/upload",
    shape: "owner-api",
    methods: ["POST"],
  },
  {
    routeKey: "/api/fin/config",
    probe: "/api/fin/config",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/layout",
    probe: "/api/layout",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/prf/wrap",
    probe: "/api/prf/wrap",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/rotation",
    probe: "/api/rotation",
    shape: "owner-api",
    methods: ["GET", "PUT", "DELETE"],
  },
  {
    routeKey: "/api/rotation/listing",
    probe: "/api/rotation/listing",
    shape: "owner-api",
    methods: ["GET"],
  },
  {
    routeKey: "/api/todo",
    probe: "/api/todo",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/totp",
    probe: "/api/totp",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/transit/config",
    probe: "/api/transit/config",
    shape: "owner-api",
    methods: ["GET", "PUT"],
  },
  {
    routeKey: "/api/transit/stops",
    probe: "/api/transit/stops?q=central",
    shape: "owner-api",
    methods: ["GET"],
  },
  {
    routeKey: "/api/transit/trip",
    probe: "/api/transit/trip?from=stop%3A1&to=stop%3A2",
    shape: "owner-api",
    methods: ["GET"],
  },
  {
    routeKey: "/api/vault/upload",
    probe: "/api/vault/upload",
    shape: "owner-api",
    methods: ["POST"],
  },
  {
    routeKey: "/api/vault/raw",
    probe: "/api/vault/raw?p=vault%2Fx.bin",
    shape: "owner-api",
    methods: ["GET"],
  },
  {
    routeKey: "/api/briefing/ingest",
    probe: "/api/briefing/ingest",
    shape: "owner-api",
    methods: ["POST"],
    note: "Bearer-gated hidden owner surface (ADR 0022). Secretless CI is production with no BRIEFING_INGEST_SECRET → the gate fails CLOSED → every call 404s, including a valid-shaped body: no route-exists or validation oracle.",
  },
  {
    routeKey: "/api/daily/steps",
    probe: "/api/daily/steps",
    shape: "owner-api",
    methods: ["POST"],
    note: "Bearer-gated hidden owner surface (ADR 0022) — the phone's daily step push. Secretless CI is production with no STEPS_INGEST_SECRET → the gate fails CLOSED → every call 404s, including a valid-shaped body: no route-exists or validation oracle.",
  },
  {
    routeKey: "/files/share-target",
    probe: "/files/share-target",
    shape: "owner-api",
    methods: ["POST"],
    note: "PWA share-target server fallback (ADR 0053). Not under /api, so the CSP proxy runs on it — it carries the report-only headers the /api routes don't; the guest 404 body + security headers still match the wall.",
  },

  // -- owner-gated pages (guest → notFound() → HTML 404, nonce in body) ----------
  {
    routeKey: "/files",
    probe: "/files",
    shape: "owner-page",
    methods: ["GET"],
  },
  {
    routeKey: "/portfolio",
    probe: "/portfolio",
    shape: "owner-page",
    methods: ["GET"],
  },
  {
    routeKey: "/reader",
    probe: "/reader",
    shape: "owner-page",
    methods: ["GET"],
  },
  {
    routeKey: "/system",
    probe: "/system",
    shape: "owner-page",
    methods: ["GET"],
  },
  {
    routeKey: "/transit",
    probe: "/transit",
    shape: "owner-page",
    methods: ["GET"],
  },
  {
    routeKey: "/uses",
    probe: "/uses",
    shape: "owner-page",
    methods: ["GET"],
    note: "Pulled from the public face 2026-07-14; owner-only until reworked.",
  },
  {
    routeKey: "/vault",
    probe: "/vault",
    shape: "owner-page",
    methods: ["GET"],
  },
  {
    routeKey: "/vault/[id]",
    probe: "/vault/abc123XYZ",
    shape: "owner-page",
    methods: ["GET"],
  },

  // -- public inert recorders (empty 204 to everything, no oracle) ---------------
  {
    routeKey: "/api/hit",
    probe: "/api/hit",
    shape: "public-inert",
    methods: ["POST"],
    note: "Cookieless pageview beacon (ADR: analytics). Public, but every branch is an empty 204 — no counter, no oracle.",
  },
  {
    routeKey: "/api/csp-report",
    probe: "/api/csp-report",
    shape: "public-inert",
    methods: ["POST"],
    note: "First-party CSP collector (roadmap 37e). Public, but every branch is an empty 204 — valid, junk, or oversized alike.",
  },

  // -- deliberately public serving surfaces (reason recorded per entry) ----------
  {
    routeKey: "/api/dropbox",
    probe: "/api/dropbox",
    shape: "public-serving",
    methods: ["POST"],
    note: "Sealed drop-box ingest (ADR 0062). A stranger is the caller, so it MUST NOT 404; every rejection is a generic 400/429/503 with no detail — no which-gate-tripped oracle.",
  },
  {
    routeKey: "/api/dropbox/pubkey",
    probe: "/api/dropbox/pubkey",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public box public-key read (ADR 0062). Hands back the public point only; when the box is off (store off in CI) it 404s with no enabled/disabled oracle.",
  },
  {
    routeKey: "/api/share/[id]",
    probe: `/api/share/${SHARE_SEG}`,
    shape: "public-serving",
    methods: ["GET"],
    note: "Fragment-key share serve (ADR 0058) — the one public blob-serving route. Ciphertext only; malformed/expired/absent all collapse to one 404 (no existence/expiry oracle).",
  },
  {
    routeKey: "/api/auth/webauthn/auth-options",
    probe: "/api/auth/webauthn/auth-options",
    shape: "public-serving",
    methods: ["POST"],
    note: "Passkey sign-in options (ADR 0056) — the only public WebAuthn endpoint. Byte-shaped identically whether zero or twelve credentials exist: a probe learns nothing.",
  },
  {
    routeKey: "/icons/[icon]",
    probe: "/icons/192",
    shape: "public-serving",
    methods: ["GET"],
    note: "PWA icon renderer (ADR: PWA). Public, prerendered PNGs; an unknown spec is a plain 404 — an asset route, not an owner surface.",
  },
  {
    routeKey: "/",
    probe: "/",
    shape: "public-serving",
    methods: ["GET"],
    note: "The public lobby.",
  },
  {
    routeKey: "/briefing",
    probe: "/briefing",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public markets briefing (owner note hidden from guests).",
  },
  {
    routeKey: "/contact",
    probe: "/contact",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public contact + drop-box composer.",
  },
  {
    routeKey: "/notes",
    probe: "/notes",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public notes index.",
  },
  {
    routeKey: "/notes/[slug]",
    probe: "/notes/does-not-exist-slug",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public note page; an unknown slug is a plain 404, present ones 200 — content, not an owner surface.",
  },
  {
    routeKey: "/novels",
    probe: "/novels",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public reading list.",
  },
  {
    routeKey: "/offline",
    probe: "/offline",
    shape: "public-serving",
    methods: ["GET"],
    note: "PWA offline fallback page.",
  },
  {
    routeKey: "/projects",
    probe: "/projects",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public projects index.",
  },
  {
    routeKey: "/projects/riichi",
    probe: "/projects/riichi",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public case study.",
  },
  {
    routeKey: "/projects/ishin",
    probe: "/projects/ishin",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public case study.",
  },
  {
    routeKey: "/riichi",
    probe: "/riichi",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public hand-of-the-day.",
  },
  {
    routeKey: "/s/[id]",
    probe: `/s/${SHARE_SEG}`,
    shape: "public-serving",
    methods: ["GET"],
    note: "Fragment-key share recipient page (ADR 0058). Public by design; a malformed id 404s, a well-formed one renders the decrypt page.",
  },
  {
    routeKey: "/ishin",
    probe: "/ishin",
    shape: "public-serving",
    methods: ["GET"],
    note: "Public ishin translation stats (private feed hidden from guests).",
  },

  // -- Auth.js catch-all + the cron endpoint (their own contracts) ---------------
  {
    routeKey: "/api/auth/[...nextauth]",
    probe: "/api/auth/session",
    shape: "auth-handler",
    methods: ["GET", "POST"],
    note: "Auth.js catch-all. Its own redirect/JSON contract (session JSON, signin 302); not a 404-walled surface. Guest-facing invariants are locked in gating.spec.ts.",
  },
  {
    routeKey: "/api/cron/snapshot",
    probe: "/api/cron/snapshot",
    shape: "cron",
    methods: ["GET"],
    note: "Nightly cron writer. Fail-closed 401 when unauthenticated (lib/cron-auth) — a locked machine endpoint, deliberately NOT the 404 wall.",
  },
];

/** Every entry whose guest contract is the byte-identical 404 "Not found" wall. */
export const ownerApiRoutes = (): RouteEntry[] =>
  ROUTE_MANIFEST.filter((r) => r.shape === "owner-api");

/** Every entry whose guest contract is an HTML 404 via notFound(). */
export const ownerPageRoutes = (): RouteEntry[] =>
  ROUTE_MANIFEST.filter((r) => r.shape === "owner-page");

/** The public recorders that must answer an empty 204 to everything. */
export const publicInertRoutes = (): RouteEntry[] =>
  ROUTE_MANIFEST.filter((r) => r.shape === "public-inert");

// ---------------------------------------------------------------------------
// Traversal payloads
// ---------------------------------------------------------------------------

/**
 * Path-traversal spellings, each an escape attempt aimed at the keystore — the
 * crown-jewel blob a `raw`/`dl`/`[id]` handler must never be talked into serving.
 * Boring and exhaustive on purpose: raw, single-/double-encoded, backslash,
 * null-byte, and unicode dot variants. `prefix` lets a caller aim the escape from
 * inside a store namespace (e.g. `"inbox/"`) or from a bare URL segment (`""`).
 *
 * The strings are returned ready to drop into a URL as-is (already percent-encoded
 * where they need to be). Bounded to a fixed set — the corpus is a spec.
 */
export function traversalPayloads(prefix = ""): string[] {
  const target = "meta/keystore";
  const spellings = [
    `../${target}`, // raw
    `..%2f${target.replace(/\//g, "%2f")}`, // single-encoded slash
    `..%252f${target.replace(/\//g, "%252f")}`, // double-encoded slash
    `%2e%2e/${target}`, // encoded dots
    `%2e%2e%2f${target.replace(/\//g, "%2f")}`, // encoded dots + slash
    `..\\${target.replace(/\//g, "\\")}`, // backslash separators
    `..%5c${target.replace(/\//g, "%5c")}`, // encoded backslash
    `../${target}%00.bin`, // null-byte truncation
    `%c0%ae%c0%ae/${target}`, // overlong-UTF8 dots
    `．．/${target}`, // fullwidth unicode dots
  ];
  return spellings.map((s) => `${prefix}${s}`);
}

// ---------------------------------------------------------------------------
// Envelope / body fuzz
// ---------------------------------------------------------------------------

export interface FuzzCase {
  label: string;
  /** Ready to pass straight to Playwright's `data:` (string or raw bytes). */
  body: string | Uint8Array;
  /** Sent as-is so a route that sniffs content-type still gets fuzzed. */
  contentType: string;
}

/**
 * Hostile request bodies for every PUT/POST surface. Targets three validators at
 * once: the E2EE envelope frame (`AEV1` magic + min length, /api/fin/config), the
 * JSON shape guards (keystore/prf/dropbox-key), and the raw byte caps
 * (dropbox/csp-report/hit). `maxBytes` sizes the one oversized case just past the
 * largest cap under test, so the "too big" branch is exercised.
 *
 * Bounded to a fixed dozen — enough to hit every frame/parse/size branch, small
 * enough to stay inside the CI budget when fanned across a dozen body routes.
 */
export function envelopeFuzz(maxBytes: number): FuzzCase[] {
  const bin = (bytes: number[]): Uint8Array => new Uint8Array(bytes);
  const magic = [0x41, 0x45, 0x56, 0x31]; // "AEV1"
  return [
    { label: "empty", body: bin([]), contentType: "application/octet-stream" },
    { label: "zero-bytes-json", body: "", contentType: "application/json" },
    {
      label: "truncated-magic",
      body: bin([0x41, 0x45, 0x56]),
      contentType: "application/octet-stream",
    },
    {
      label: "wrong-magic",
      body: bin([0x58, 0x58, 0x58, 0x58, ...Array(40).fill(0)]),
      contentType: "application/octet-stream",
    },
    {
      label: "valid-frame-garbage-body",
      body: bin([...magic, ...Array(40).fill(0x7a)]),
      contentType: "application/octet-stream",
    },
    {
      label: "non-utf8",
      body: bin([0xff, 0xfe, 0xfd, 0xfc, 0x00, 0x80, 0x81]),
      contentType: "application/octet-stream",
    },
    { label: "unterminated-json", body: "{", contentType: "application/json" },
    { label: "json-null", body: "null", contentType: "application/json" },
    { label: "json-empty-array", body: "[]", contentType: "application/json" },
    {
      label: "json-wrong-shape",
      body: '{"v":999,"evil":true}',
      contentType: "application/json",
    },
    { label: "not-json", body: "not json at all", contentType: "text/plain" },
    {
      label: "oversized",
      body: new Uint8Array(maxBytes + 1),
      contentType: "application/octet-stream",
    },
  ];
}

// ---------------------------------------------------------------------------
// Header spoofs
// ---------------------------------------------------------------------------

/** A nonce a client tries to smuggle into SSR by presetting the CSP request header. */
export const SPOOF_NONCE = "c3Bvb2ZlZC1ub25jZS12YWx1ZQ==";

export interface HeaderSpoof {
  label: string;
  headers: Record<string, string>;
}

/**
 * Headers a client should never be able to make survive the proxy (src/proxy.ts):
 *   - `x-nonce` / `Content-Security-Policy` — a smuggled nonce would let injected
 *     inline script inherit trust; the proxy `.set()`s its own, overwriting these.
 *   - `x-middleware-subrequest` — the CVE-2025-29927 middleware-bypass header;
 *     it must not skip the proxy (the CSP header must still be minted).
 *   - `x-middleware-request-*` / `x-invoke-*` — internal routing headers a client
 *     must not be able to forge.
 *   - junk `x-forwarded-for` — the rate-limiters split on it; malformed values must
 *     never 500.
 */
export function headerSpoofs(): HeaderSpoof[] {
  return [
    { label: "spoofed-x-nonce", headers: { "x-nonce": SPOOF_NONCE } },
    {
      label: "spoofed-csp-request-header",
      headers: {
        "content-security-policy": `script-src 'nonce-${SPOOF_NONCE}' 'unsafe-inline'`,
      },
    },
    {
      label: "middleware-subrequest-bypass",
      headers: { "x-middleware-subrequest": "proxy" },
    },
    {
      label: "forged-internal-routing",
      headers: {
        "x-middleware-rewrite": "/system",
        "x-invoke-path": "/system",
      },
    },
    {
      label: "junk-xff-garbage",
      headers: { "x-forwarded-for": "not-an-ip, <script>alert(1)</script>" },
    },
    {
      label: "junk-xff-oversized",
      headers: { "x-forwarded-for": `${"9".repeat(4096)}` },
    },
  ];
}

// ---------------------------------------------------------------------------
// Method matrix
// ---------------------------------------------------------------------------

/** Every verb probed against every route — an accidental handler is a finding. */
export const ALL_METHODS: Method[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

/**
 * The security headers compared route-to-route for uniformity (never to a
 * hard-coded value — that stays in gating.spec.ts, and one open PR is changing the
 * HSTS value). Deliberately EXCLUDES the proxy-managed + volatile headers
 * (`content-security-policy-report-only`, `reporting-endpoints`, `date`,
 * `content-length`): those legitimately differ between /api and proxied paths and
 * would make the wall look non-uniform when it isn't.
 */
export const UNIFORMITY_HEADERS = [
  "content-type",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security",
];
