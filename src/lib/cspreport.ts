/**
 * Pure parsing + folding for first-party CSP violation reports (roadmap 37e). The
 * hub ships a strict nonce CSP; a same-origin `report-uri`/`report-to` endpoint
 * collects what browsers send, and this layer turns that HOSTILE, browser-dependent
 * wire input into small daily fold records the owner panel reads. No I/O and no
 * `next/*` import — the route wires it to the guarded cspstore (mirrors analytics.ts
 * next to anastore.ts).
 *
 * Two wire shapes browsers still disagree on collapse to ONE normalized record:
 *   - legacy `report-uri`: `{ "csp-report": { "effective-directive", "blocked-uri",
 *     "document-uri", … } }`
 *   - Reporting API batch: `[{ type: "csp-violation", url, body: { effectiveDirective,
 *     blockedURL, documentURL, … } }, …]`
 *
 * Every field is allow-listed and capped, URLs are stripped (blocked → origin;
 * document → PATH ONLY, dropping query + fragment before anything persists, since
 * they can carry tokens), and anything non-conforming is dropped silently.
 */

/** One violation, reduced to the three axes worth aggregating. */
export interface NormalizedReport {
  directive: string;
  blockedOrigin: string;
  pagePath: string;
}

// Field caps. Directives are short names; origins/paths a touch longer. A value past
// its cap is truncated, not the reason to drop the whole report.
const MAX_DIRECTIVE = 64;
const MAX_ORIGIN = 128;
const MAX_PATH = 128;

/** Reporting API batches can list many violations; fold only a small head so one
 *  request can't drive unbounded work. */
const MAX_ITEMS = 10;

/** Distinct-key cap per day — past it, new keys fold into one bucket so a flood (a
 *  fuzzed page path, a rotating injected host) can't balloon the stored blob. */
export const MAX_KEYS = 200;
export const OVERFLOW_KEY = "other";

// Network schemes keep their full origin; everything else (data:, blob:, about:,
// extension URIs) collapses to the bare scheme name.
const NETWORK_SCHEMES = new Set(["http", "https", "ws", "wss"]);

function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

/** A CSP directive NAME. Legacy `violated-directive` carries the whole directive incl.
 *  its value ("script-src 'self'"), so keep only the first token; allow-list to the
 *  grammar's name chars; `null` when nothing survives. */
function sanitizeDirective(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const name = (x.trim().split(/\s+/)[0] ?? "").toLowerCase();
  const clean = name.replace(/[^a-z0-9-]/g, "");
  return clean === "" ? null : cap(clean, MAX_DIRECTIVE);
}

/** The blocked resource reduced to an origin (or a keyword). A base64 `data:` payload
 *  must never reach a key — it bloats the blob and can carry page content — so any
 *  non-network scheme collapses to its bare name; a network URL keeps only its origin;
 *  CSP keywords (`inline`, `eval`, `self`) pass through. */
function sanitizeBlockedUri(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const raw = x.trim();
  if (raw === "") return null;
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !NETWORK_SCHEMES.has(scheme)) return cap(scheme, MAX_ORIGIN);
  try {
    // A network URL → origin only: drop path/query/fragment, which can carry tokens.
    return cap(new URL(raw).origin, MAX_ORIGIN);
  } catch {
    // Not a URL — a CSP keyword like `inline`/`eval`/`self`. Allow-list + cap.
    const kw = raw.toLowerCase().replace(/[^a-z-]/g, "");
    return kw === "" ? null : cap(kw, MAX_ORIGIN);
  }
}

/** The violating page as a PATH — same-origin so the host adds nothing, and the query
 *  and fragment (which can carry tokens) are dropped BEFORE anything persists. */
function sanitizePath(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const raw = x.trim();
  if (raw === "") return null;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    // Already a bare path — cut the query/fragment by hand.
    path = raw.split(/[?#]/)[0];
  }
  if (!path.startsWith("/")) return null;
  // A URL pathname never carries control bytes; guard the bare-path branch anyway.
  if (/[\u0000-\u001f]/.test(path)) return null;
  return cap(path, MAX_PATH);
}

/** All three axes or nothing — a report missing any is dropped silently. */
function build(
  dir: unknown,
  blocked: unknown,
  doc: unknown,
): NormalizedReport | null {
  const directive = sanitizeDirective(dir);
  const blockedOrigin = sanitizeBlockedUri(blocked);
  const pagePath = sanitizePath(doc);
  if (directive === null || blockedOrigin === null || pagePath === null)
    return null;
  return { directive, blockedOrigin, pagePath };
}

/** Normalize a single legacy `{ "csp-report": {…} }` body. */
export function normalizeLegacy(body: unknown): NormalizedReport | null {
  if (typeof body !== "object" || body === null) return null;
  const r = (body as Record<string, unknown>)["csp-report"];
  if (typeof r !== "object" || r === null) return null;
  const rr = r as Record<string, unknown>;
  return build(
    rr["effective-directive"] ?? rr["violated-directive"],
    rr["blocked-uri"],
    rr["document-uri"],
  );
}

/** Normalize one Reporting API item; non-`csp-violation` items (a mixed batch may
 *  carry deprecation/intervention reports) are skipped. */
export function normalizeReport(item: unknown): NormalizedReport | null {
  if (typeof item !== "object" || item === null) return null;
  const it = item as Record<string, unknown>;
  if (it.type !== "csp-violation") return null;
  const b = it.body;
  if (typeof b !== "object" || b === null) return null;
  const bb = b as Record<string, unknown>;
  return build(bb.effectiveDirective, bb.blockedURL, bb.documentURL ?? it.url);
}

/** The single entry the route calls: an array is a Reporting API batch (capped), an
 *  object is a legacy report. Junk yields an empty list, never a throw. */
export function parseReports(body: unknown): NormalizedReport[] {
  if (Array.isArray(body)) {
    return body
      .slice(0, MAX_ITEMS)
      .map(normalizeReport)
      .filter((r): r is NormalizedReport => r !== null);
  }
  const one = normalizeLegacy(body);
  return one ? [one] : [];
}

// --- daily fold record --------------------------------------------------------

/** One day of violation counts, keyed `"<directive>|<blockedOrigin>|<pagePath>"`. */
export interface CspDay {
  v: 1;
  date: string;
  counts: Record<string, number>;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A fresh empty day (the recorder starts here on the first report of a day). */
export function emptyCspDay(date: string): CspDay {
  return { v: 1, date, counts: {} };
}

/** Strict guard for a stored day record (the recorder read-modify-writes it, so a
 *  corrupt-but-readable blob must be rejected rather than overwritten from empty). */
export function isCspDay(x: unknown): x is CspDay {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Record<string, unknown>;
  if (d.v !== 1 || typeof d.date !== "string" || !YMD.test(d.date))
    return false;
  if (typeof d.counts !== "object" || d.counts === null) return false;
  for (const v of Object.values(d.counts as Record<string, unknown>)) {
    if (!Number.isSafeInteger(v) || (v as number) < 0) return false;
  }
  return true;
}

function keyOf(n: NormalizedReport): string {
  return `${n.directive}|${n.blockedOrigin}|${n.pagePath}`;
}

/** Upsert one normalized report into a day (mutates). Once the day holds MAX_KEYS
 *  distinct keys, a NEW key folds into the single OVERFLOW_KEY bucket instead — so a
 *  flood adds at most one more key, never an unbounded map. */
export function foldReport(day: CspDay, n: NormalizedReport): void {
  const key = keyOf(n);
  if (key in day.counts) {
    day.counts[key] += 1;
    return;
  }
  if (Object.keys(day.counts).length >= MAX_KEYS) {
    day.counts[OVERFLOW_KEY] = (day.counts[OVERFLOW_KEY] ?? 0) + 1;
    return;
  }
  day.counts[key] = 1;
}

// --- panel aggregation --------------------------------------------------------

export interface CspOriginCount {
  origin: string;
  count: number;
}

export interface CspDirectiveGroup {
  directive: string;
  total: number;
  origins: CspOriginCount[];
}

/**
 * Aggregate day records into per-directive groups, each carrying its blocked origins
 * ordered by count, with directives ordered by total — exactly what the owner panel
 * renders. Pure so the component stays a thin view. The OVERFLOW_KEY bucket has no
 * separators, so it surfaces as an `other` directive with an unknown origin.
 */
export function summarizeCsp(days: CspDay[]): {
  total: number;
  groups: CspDirectiveGroup[];
} {
  const byDir = new Map<string, Map<string, number>>();
  let total = 0;
  for (const day of days) {
    for (const [key, n] of Object.entries(day.counts)) {
      const parts = key.split("|");
      const directive = parts[0] || "?";
      const origin = parts[1] || "?";
      total += n;
      const origins = byDir.get(directive) ?? new Map<string, number>();
      origins.set(origin, (origins.get(origin) ?? 0) + n);
      byDir.set(directive, origins);
    }
  }
  const groups = [...byDir.entries()]
    .map(([directive, origins]) => {
      const list = [...origins.entries()]
        .map(([origin, count]) => ({ origin, count }))
        .sort((a, b) => b.count - a.count);
      return {
        directive,
        total: list.reduce((s, o) => s + o.count, 0),
        origins: list,
      };
    })
    .sort((a, b) => b.total - a.total);
  return { total, groups };
}
