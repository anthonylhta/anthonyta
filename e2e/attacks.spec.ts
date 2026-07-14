import fs from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  ALL_METHODS,
  envelopeFuzz,
  headerSpoofs,
  ownerApiRoutes,
  ownerPageRoutes,
  publicInertRoutes,
  ROUTE_MANIFEST,
  SPOOF_NONCE,
  traversalPayloads,
  UNIFORMITY_HEADERS,
  type Method,
  type RouteEntry,
} from "./attack-corpus";

/**
 * The adversarial battery (security backlog PR 15). gating.spec.ts locks routes
 * case-by-case; this locks the PROPERTIES the wall rests on — that no oracle
 * distinguishes absent from error, that every malformed body dies the same way,
 * that a spoofed header never survives the proxy, that a route can't be added
 * without inheriting the battery. It runs against the same secretless production
 * build (store off), because hostile-input handling is exactly what must hold with
 * nothing configured.
 *
 * Uniformity is the property, so the assertions compare responses to EACH OTHER,
 * not to hard-coded expectations — a byte-exact baseline lives in gating.spec.ts,
 * and one open PR is changing the HSTS value, so nothing here pins a literal.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Probe {
  method: Method;
  url: string;
  headers?: Record<string, string>;
  data?: string | Buffer;
}

/** Fire one probe without following redirects or throwing on status. */
async function hit(request: APIRequestContext, p: Probe) {
  return request.fetch(p.url, {
    method: p.method,
    headers: p.headers,
    data: p.data,
    maxRedirects: 0,
    failOnStatusCode: false,
  });
}

/** The security-header slice compared route-to-route (never to a literal). */
function secHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UNIFORMITY_HEADERS) out[k] = headers[k] ?? "<absent>";
  return out;
}

/** The base path of a probe, minus any query — the method matrix hits this. */
function basePath(probe: string): string {
  const q = probe.indexOf("?");
  return q === -1 ? probe : probe.slice(0, q);
}

// ---------------------------------------------------------------------------
// 1. Completeness — the manifest can't fall behind the route tree
// ---------------------------------------------------------------------------

/**
 * Derive the app's real route list from the filesystem and diff it against the
 * manifest. This is what makes the whole battery self-maintaining: a new route.ts
 * or page.tsx that nobody registered fails HERE, so it can't quietly escape the
 * probes. Route groups `(name)` collapse out of the URL; `_private`/`@slot` folders
 * aren't routable and are skipped; dynamic segments (`[id]`, `[...nextauth]`) are
 * kept literally, exactly as the manifest spells them.
 */
function deriveRouteKeys(appDir: string): string[] {
  const keys: string[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const name = ent.name;
        if (name.startsWith("_") || name.startsWith("@")) continue; // not routable
        const next =
          name.startsWith("(") && name.endsWith(")")
            ? segs // route group — contributes no URL segment
            : [...segs, name];
        walk(path.join(dir, name), next);
      } else if (/^(route|page)\.(t|j)sx?$/.test(ent.name)) {
        keys.push("/" + segs.join("/"));
      }
    }
  };
  walk(appDir, []);
  // The root page.tsx yields "/" (segs empty → "/" + "" === "/").
  return keys.map((k) => (k === "/" ? "/" : k.replace(/\/$/, "")));
}

test("the manifest matches the app's route tree exactly", () => {
  const appDir = path.resolve(process.cwd(), "src", "app");
  const onDisk = new Set(deriveRouteKeys(appDir));
  const declared = new Set(ROUTE_MANIFEST.map((r) => r.routeKey));

  const missing = [...onDisk].filter((k) => !declared.has(k)).sort();
  const stale = [...declared].filter((k) => !onDisk.has(k)).sort();

  expect(
    missing,
    `routes on disk but NOT in the manifest — register them so they inherit the battery: ${missing.join(", ")}`,
  ).toEqual([]);
  expect(
    stale,
    `routes in the manifest but NOT on disk — remove the stale entries: ${stale.join(", ")}`,
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// 2. Uniformity — every owner surface presents ONE 404, whatever the input
// ---------------------------------------------------------------------------

/** Build the hostile-variant probe list for one owner-API route. */
function ownerApiProbes(r: RouteEntry): Probe[] {
  const probes: Probe[] = [];
  const base = basePath(r.probe);
  const hasQueryP = r.probe.includes("?p=");
  const bodyMethods = new Set<Method>(["POST", "PUT", "DELETE"]);

  for (const method of r.methods) {
    // A benign call on each declared verb.
    probes.push({ method, url: r.probe });

    // Traversal payloads for the routes that read a `?p=` pathname.
    if (hasQueryP && method === "GET") {
      for (const payload of traversalPayloads("inbox/")) {
        probes.push({ method, url: `${base}?p=${payload}` });
      }
    }

    // A few fuzz bodies for the write verbs (the guest gate should eat them all).
    if (bodyMethods.has(method)) {
      for (const c of envelopeFuzz(64 * 1024).slice(0, 4)) {
        probes.push({
          method,
          url: r.probe,
          headers: { "content-type": c.contentType },
          data: typeof c.body === "string" ? c.body : Buffer.from(c.body),
        });
      }
    }
  }
  return probes;
}

test("every owner-API surface answers ONE indistinguishable 404", async ({
  request,
}) => {
  const routes = ownerApiRoutes();
  const seen: { where: string; fp: string }[] = [];

  await Promise.all(
    routes.map(async (r) => {
      for (const p of ownerApiProbes(r)) {
        const res = await hit(request, p);
        const body = await res.text();
        const fp = JSON.stringify({
          status: res.status(),
          body,
          headers: secHeaders(res.headers()),
        });
        seen.push({ where: `${p.method} ${p.url}`, fp });
      }
    }),
  );

  // Every response — across every owner-API route, verb, traversal, and fuzz body
  // — must be byte-identical: status, body text, and the security headers. If any
  // differs, a prober has an oracle.
  const ref = seen[0];
  for (const s of seen) {
    expect(
      s.fp,
      `${s.where} is distinguishable from ${ref.where}:\n  ${s.fp}\n  vs\n  ${ref.fp}`,
    ).toBe(ref.fp);
  }
  // Sanity: the shared response is actually the 404 wall.
  expect(JSON.parse(ref.fp).status).toBe(404);
  expect(JSON.parse(ref.fp).body).toBe("Not found");
});

test("every owner-PAGE surface answers ONE indistinguishable HTML 404", async ({
  request,
}) => {
  const routes = ownerPageRoutes();
  const seen: { where: string; status: number; ct: string; sec: string }[] = [];

  await Promise.all(
    routes.map(async (r) => {
      // The base page plus a traversal-shaped id on the dynamic one.
      const urls = [r.probe];
      if (r.routeKey.includes("[id]")) {
        const parent = r.probe.slice(0, r.probe.lastIndexOf("/"));
        urls.push(`${parent}/..%2f..%2fetc%2fpasswd`);
      }
      for (const url of urls) {
        const res = await hit(request, { method: "GET", url });
        seen.push({
          where: url,
          status: res.status(),
          ct: (res.headers()["content-type"] ?? "").split(";")[0],
          sec: JSON.stringify(secHeaders(res.headers())),
        });
      }
    }),
  );

  // Pages inject a per-request CSP nonce into the HTML, so bodies aren't
  // byte-compared — status, content-type, and the security headers are.
  const ref = seen[0];
  for (const s of seen) {
    expect(s.status, `${s.where} status`).toBe(404);
    expect(s.ct, `${s.where} content-type`).toBe(ref.ct);
    expect(s.sec, `${s.where} security headers`).toBe(ref.sec);
  }
  expect(ref.ct).toBe("text/html");
});

// ---------------------------------------------------------------------------
// 3. Method matrix — an accidental handler is a finding
// ---------------------------------------------------------------------------

test("no route crashes (5xx) on any HTTP verb", async ({ request }) => {
  const offenders: string[] = [];
  await Promise.all(
    ROUTE_MANIFEST.map(async (r) => {
      for (const method of ALL_METHODS) {
        const res = await hit(request, { method, url: basePath(r.probe) });
        if (res.status() >= 500)
          offenders.push(`${method} ${r.routeKey} → ${res.status()}`);
      }
    }),
  );
  expect(offenders, `verbs that 5xx: ${offenders.join(", ")}`).toEqual([]);
});

test("undeclared verbs never reach a handler on locked surfaces", async ({
  request,
}) => {
  // On owner + inert surfaces, only the declared verbs (plus framework-auto OPTIONS
  // and HEAD-from-GET) may do anything. Any OTHER verb returning a 2xx/3xx means an
  // accidental handler ran — the finding the method matrix exists to catch.
  const locked = ROUTE_MANIFEST.filter(
    (r) =>
      r.shape === "owner-api" ||
      r.shape === "owner-page" ||
      r.shape === "public-inert",
  );
  const findings: string[] = [];

  await Promise.all(
    locked.map(async (r) => {
      const declared = new Set<Method>(r.methods);
      for (const method of ALL_METHODS) {
        if (method === "OPTIONS" || method === "HEAD") continue; // framework-auto
        if (declared.has(method)) continue;
        const res = await hit(request, { method, url: basePath(r.probe) });
        const s = res.status();
        // A framework "method not allowed"/"not found" (>= 400) is fine; a success
        // or redirect is an accidental handler.
        if (s < 400) findings.push(`${method} ${r.routeKey} → ${s}`);
      }
    }),
  );

  expect(
    findings,
    `accidental handlers (undeclared verb returned <400): ${findings.join(", ")}`,
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// 4. Envelope fuzz — public body routes stay inert / generic
// ---------------------------------------------------------------------------

test("the public recorders answer an empty 204 to every fuzz body", async ({
  request,
}) => {
  const fuzz = envelopeFuzz(64 * 1024);
  const bad: string[] = [];
  await Promise.all(
    publicInertRoutes().map(async (r) => {
      for (const c of fuzz) {
        const res = await hit(request, {
          method: "POST",
          url: r.probe,
          headers: { "content-type": c.contentType },
          data: typeof c.body === "string" ? c.body : Buffer.from(c.body),
        });
        const body = await res.text();
        if (res.status() !== 204 || body !== "")
          bad.push(
            `${r.routeKey} [${c.label}] → ${res.status()} "${body.slice(0, 24)}"`,
          );
      }
    }),
  );
  expect(
    bad,
    `recorders that leaked a non-204/oracle: ${bad.join(", ")}`,
  ).toEqual([]);
});

test("the public drop-box ingest rejects every fuzz body generically, never 404", async ({
  request,
}) => {
  // It's a public surface (a stranger seals a message), so it must NOT answer the
  // owner-gate 404; every rejection is a generic 400/429/503 with no which-gate
  // detail, and it never crashes.
  const fuzz = envelopeFuzz(64 * 1024);
  const bad: string[] = [];
  for (const c of fuzz) {
    const res = await hit(request, {
      method: "POST",
      url: "/api/dropbox",
      headers: { "content-type": c.contentType },
      data: typeof c.body === "string" ? c.body : Buffer.from(c.body),
    });
    const s = res.status();
    if (s === 404 || ![400, 429, 503].includes(s))
      bad.push(`[${c.label}] → ${s}`);
  }
  expect(
    bad,
    `drop-box responses out of {400,429,503}: ${bad.join(", ")}`,
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// 5. Header spoofs — nothing a client sends survives the proxy
// ---------------------------------------------------------------------------

const NONCE_RE = /'nonce-([A-Za-z0-9+/=]+)'/;

test("a spoofed nonce / CSP request header never reaches the response", async ({
  request,
}) => {
  const spoofs = headerSpoofs();
  const nonceSpoof = spoofs.find((s) => s.label === "spoofed-x-nonce")!;
  const cspSpoof = spoofs.find(
    (s) => s.label === "spoofed-csp-request-header",
  )!;

  const res = await hit(request, {
    method: "GET",
    url: "/",
    headers: { ...nonceSpoof.headers, ...cspSpoof.headers },
  });
  const csp = res.headers()["content-security-policy-report-only"] ?? "";
  const minted = csp.match(NONCE_RE)?.[1];

  // The proxy minted its own nonce (overwriting the smuggled one) and never echoed
  // the attacker's directive. Scope the unsafe-inline check to script-src — style-src
  // legitimately carries 'unsafe-inline' (Tailwind/next-font), the scripts don't.
  const scriptSrc = csp.match(/script-src ([^;]*)/)?.[1] ?? "";
  expect(minted, "response should carry a freshly minted nonce").toBeTruthy();
  expect(minted).not.toBe(SPOOF_NONCE);
  expect(csp).not.toContain(SPOOF_NONCE);
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).toContain(`'nonce-${minted}'`);

  // And the minted nonce is what Next stamped into the HTML, not the spoof.
  const html = await res.text();
  expect(html).toContain(`nonce="${minted}"`);
  expect(html).not.toContain(SPOOF_NONCE);
});

test("the middleware-subrequest bypass header does not skip the proxy", async ({
  request,
}) => {
  // CVE-2025-29927: a client setting x-middleware-subrequest must not bypass the
  // proxy — the strict CSP must still be minted, and an owner page must still 404.
  const spoof = headerSpoofs().find(
    (s) => s.label === "middleware-subrequest-bypass",
  )!;

  const lobby = await hit(request, {
    method: "GET",
    url: "/",
    headers: spoof.headers,
  });
  expect(
    lobby.headers()["content-security-policy-report-only"],
    "proxy must still run under the bypass header",
  ).toMatch(NONCE_RE);

  const owner = await hit(request, {
    method: "GET",
    url: "/system",
    headers: spoof.headers,
  });
  expect(
    owner.status(),
    "owner page must still 404 under the bypass header",
  ).toBe(404);
});

test("junk x-forwarded-for never 500s a rate-limited route", async ({
  request,
}) => {
  // The dropbox + hit rate-limiters split on x-forwarded-for; a malformed or huge
  // value must degrade, never crash.
  const junk = headerSpoofs().filter((s) => s.label.startsWith("junk-xff"));
  for (const spoof of junk) {
    const beacon = await hit(request, {
      method: "POST",
      url: "/api/hit",
      headers: { ...spoof.headers, "content-type": "application/json" },
      data: JSON.stringify({ path: "/" }),
    });
    expect(beacon.status(), `hit under ${spoof.label}`).toBe(204);

    const owner = await hit(request, {
      method: "GET",
      url: "/api/fin/config",
      headers: spoof.headers,
    });
    expect(owner.status(), `owner route under ${spoof.label}`).toBe(404);
  }
});

// ---------------------------------------------------------------------------
// 6. Timing smoke — coarse, not a promise
// ---------------------------------------------------------------------------

test("owner 404s don't differ by an order of magnitude (coarse)", async ({
  request,
}) => {
  // A genuine constant-time proof needs a lab, not CI — this is a smoke test for the
  // GROSS regression (a 404 path that suddenly does real work a prober could time).
  // Guest-only + store-off, both branches short-circuit at the auth gate, so the
  // spread should be tiny; a generous 10x multiplier plus warm-up keeps it stable.
  const median = async (probe: Probe): Promise<number> => {
    for (let i = 0; i < 3; i++) await hit(request, probe); // warm up
    const samples: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      await hit(request, probe);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };

  const benign = await median({ method: "GET", url: "/api/fin/config" });
  const traversal = await median({
    method: "GET",
    url: "/api/files/raw?p=" + traversalPayloads("inbox/")[0],
  });

  const ratio =
    Math.max(benign, traversal) / Math.max(1, Math.min(benign, traversal));
  expect(
    ratio,
    `absent-vs-error 404 timings diverged >10x (benign ${benign.toFixed(1)}ms, traversal ${traversal.toFixed(1)}ms) — a possible timing oracle`,
  ).toBeLessThan(10);
});
