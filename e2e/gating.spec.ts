import { expect, test } from "@playwright/test";

/**
 * Guest-side security gating (ADR 0045). Locks the "a logged-out visitor must NOT
 * see X" invariants established in the security review (ADR 0022 / 0038 / 0039) so a
 * future refactor can't quietly regress them. All HTTP-level, so request-driven (no
 * browser). The *owner sees X* direction is out of scope — it needs a real session,
 * and a bug there is a broken feature, not a leak.
 */

test.describe("guest gating", () => {
  for (const path of [
    "/vault",
    "/portfolio",
    "/vault/abc123XYZ",
    "/vault/img/abc123XYZ", // the owner-gated image route (ADR 0048)
    "/files", // the owner-only files inbox
    "/api/files/dl?p=inbox%2Fx.jpg", // inbox download
    "/api/files/raw?p=inbox%2Fe-abc.bin", // E2EE ciphertext stream (ADR 0053)
    "/api/files/raw?p=meta%2Fkeystore", // keystore exfil attempt via raw
    "/api/files/keystore", // wrapped-master-key read
    "/api/fin/config", // E2EE financial config (ADR 0054; holdings too since ADR 0061)
    "/api/prf/wrap", // passkey PRF vault-unlock wraps (ADR: PRF unlock)
    "/api/fin/snapkey", // retired sealed-box route — stays 404 for everyone
    "/api/fin/snapshots?days=30", // retired sealed-history route — stays 404
    "/api/vault/raw?p=vault%2Findex", // E2EE vault index ciphertext
    "/api/vault/raw?p=vault%2Fsearch-index.bin", // E2EE semantic search index
    "/api/vault/raw?p=vault%2Fn-AAAAAAAAAAAAAAAAAAAAAA.bin", // a vault note
    "/api/vault/raw?p=meta%2Fkeystore", // keystore exfil attempt via the vault route
    "/api/dropbox/list", // owner-gated sealed drop-box listing (ADR: sealed box)
    "/api/dropbox/key", // owner-gated box keypair record (holds the sealed priv)
  ]) {
    test(`${path} is 404 for a guest`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(404);
    });
  }

  test("a path-traversal vault id is a 404, not a probe", async ({
    request,
  }) => {
    const res = await request.get("/vault/..%2f..%2fetc%2fpasswd");
    expect(res.status()).toBe(404);
  });

  test("a path-traversal files download is a 404, not a probe", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/files/dl?p=inbox/..%2f..%2fetc%2fpasswd",
    );
    expect(res.status()).toBe(404);
  });

  test("a path-traversal raw read is a 404, not a probe", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/files/raw?p=inbox%2F..%2Fmeta%2Fkeystore",
    );
    expect(res.status()).toBe(404);
  });

  test("a path-traversal vault read is a 404, not a probe", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/vault/raw?p=vault%2F..%2Fmeta%2Fkeystore",
    );
    expect(res.status()).toBe(404);
  });

  test("PUT /api/files/keystore is 404 for a guest", async ({ request }) => {
    const res = await request.put("/api/files/keystore", { data: { v: 1 } });
    expect(res.status()).toBe(404);
  });

  test("PUT /api/fin/config is 404 for a guest", async ({ request }) => {
    const res = await request.put("/api/fin/config", { data: "AEV1xxxx" });
    expect(res.status()).toBe(404);
  });

  test("PUT /api/prf/wrap is 404 for a guest", async ({ request }) => {
    const res = await request.put("/api/prf/wrap", {
      data: { v: 1, wraps: [] },
    });
    expect(res.status()).toBe(404);
  });

  test("POST /api/files/upload is 404 for a guest", async ({ request }) => {
    const res = await request.post("/api/files/upload", { data: {} });
    expect(res.status()).toBe(404);
  });

  test("POST /api/files/delete is 404 for a guest", async ({ request }) => {
    const res = await request.post("/api/files/delete", {
      data: { pathname: "inbox/x.jpg" },
    });
    expect(res.status()).toBe(404);
  });

  test("POST /files/share-target is 404 for a guest", async ({ request }) => {
    const res = await request.post("/files/share-target");
    expect(res.status()).toBe(404);
  });

  test("PUT /api/dropbox/key is 404 for a guest", async ({ request }) => {
    const res = await request.put("/api/dropbox/key", {
      data: { v: 1, alg: "ECDH-P256", pub_b64: "x", sealed_priv_b64: "y" },
    });
    expect(res.status()).toBe(404);
  });

  test("POST /api/dropbox/delete is 404 for a guest", async ({ request }) => {
    const res = await request.post("/api/dropbox/delete", {
      data: { path: "dropbox/AAAAAAAAAAAAAAAAAAAAAA.bin" },
    });
    expect(res.status()).toBe(404);
  });

  // The drop box's two DELIBERATELY PUBLIC surfaces (ADR: sealed box). Unlike the
  // owner routes above they are NOT guest-gated — a stranger is the expected caller.
  // The pubkey read must never carry the sealed private half, and the ingest route
  // answers a bot's junk with a generic 4xx/5xx, never a 404 (it isn't owner-gated).
  test("GET /api/dropbox/pubkey never leaks the private half", async ({
    request,
  }) => {
    const res = await request.get("/api/dropbox/pubkey");
    // In the secretless e2e env the store is off, so the box reads as disabled and
    // this 404s — but whatever it returns, the sealed private half is never in it.
    const body = await res.text();
    expect(body).not.toContain("sealed_priv");
    expect(body).not.toContain("priv");
  });

  test("POST /api/dropbox does not 404 (public ingest, not owner-gated)", async ({
    request,
  }) => {
    const res = await request.post("/api/dropbox", {
      data: { envelope_b64: "AAAA", nonce: 0 },
    });
    // Rejected on the proof-of-work (or the store being off), never as "not found":
    // the route is public, so it must not answer with the owner-gate 404.
    expect(res.status()).not.toBe(404);
    expect([400, 429, 503]).toContain(res.status());
  });

  // Passkey enrollment is owner-gated: no unauthenticated path may exist to
  // plant a credential, and the endpoints must be invisible (ADR 0022).
  for (const path of [
    "/api/auth/webauthn/register-options",
    "/api/auth/webauthn/register-verify",
  ]) {
    test(`POST ${path} is 404 for a guest`, async ({ request }) => {
      const res = await request.post(path, { data: {} });
      expect(res.status()).toBe(404);
    });
  }

  // The sign-in passkey inventory is owner-only on BOTH methods: listing or
  // revoking a credential must be invisible to a guest (roadmap item 37 b/c).
  test("GET /api/auth/webauthn/creds is 404 for a guest", async ({
    request,
  }) => {
    expect((await request.get("/api/auth/webauthn/creds")).status()).toBe(404);
  });

  test("DELETE /api/auth/webauthn/creds is 404 for a guest", async ({
    request,
  }) => {
    const res = await request.delete("/api/auth/webauthn/creds", {
      data: { id: "credential-id" },
    });
    expect(res.status()).toBe(404);
  });

  test("passkey auth-options are public, silent, and fresh per call", async ({
    request,
  }) => {
    // Public by design — this IS the sign-in path — but inert: an empty allow
    // list and a well-formed challenge whether or not any credential (or even
    // a blob token) exists, so a probe learns nothing.
    const res = await request.post("/api/auth/webauthn/auth-options");
    expect(res.status()).toBe(200);
    const options = await res.json();
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(options.rpId).toBe("localhost");
    expect(options.allowCredentials ?? []).toEqual([]);
    const cookie = res.headers()["set-cookie"] ?? "";
    expect(cookie).toContain("webauthn-challenge=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/auth");

    const second = await (
      await request.post("/api/auth/webauthn/auth-options")
    ).json();
    expect(second.challenge).not.toBe(options.challenge);
  });

  test("a garbage passkey callback never 5xxes, just returns to the lobby", async ({
    request,
  }) => {
    const res = await request.post("/api/auth/callback/webauthn", {
      maxRedirects: 0,
      form: { assertion: "garbage" },
    });
    expect(res.status()).toBeLessThan(500);
    expect([302, 400]).toContain(res.status());
  });

  test("break-glass recovery is unreachable by default", async ({
    request,
  }) => {
    // The lobby renders no recovery UI while WEBAUTHN_RECOVERY is unset…
    const html = await (await request.get("/")).text();
    expect(html).not.toContain("recovery code");
    // …and a recovery-shaped callback grants no session.
    const res = await request.post("/api/auth/callback/webauthn", {
      maxRedirects: 0,
      form: { recovery: "any-code" },
    });
    expect(res.status()).toBeLessThan(500);
    const session = await (await request.get("/api/auth/session")).json();
    expect(session?.user).toBeFalsy();
  });

  test("/ serves the lobby, never the command center", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("reading is live"); // lobby footer
    expect(html).not.toContain("command center");
    expect(html).not.toContain("private command center");
    expect(html).not.toContain("net worth"); // command-center-only
    expect(html).not.toContain("chequing");
  });

  test("/briefing hides the owner-only portfolio note", async ({ request }) => {
    const html = await (await request.get("/briefing")).text();
    expect(html).not.toContain("portfolio relevance");
  });

  test("/translator hides the private recent feed", async ({ request }) => {
    const html = await (await request.get("/translator")).text();
    expect(html).not.toContain("private"); // the recent-feed badge is owner-only
  });

  test("robots.txt and sitemap.xml expose no owner paths", async ({
    request,
  }) => {
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      const body = await (await request.get(path)).text();
      expect(body, `${path} leaks /vault`).not.toContain("/vault");
      expect(body, `${path} leaks /portfolio`).not.toContain("/portfolio");
      expect(body, `${path} leaks /files`).not.toContain("/files");
    }
  });

  test("baseline security headers are set", async ({ request }) => {
    const h = (await request.get("/")).headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("the auth sign-in page redirects to the lobby (never renders)", async ({
    request,
  }) => {
    const res = await request.get("/api/auth/signin", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    // Lands on the lobby root — robust to relative vs absolute Location and any query.
    const loc = res.headers()["location"] ?? "";
    expect(new URL(loc, "http://localhost:3210").pathname).toBe("/");
  });

  test("the cron write endpoint rejects an unauthenticated call", async ({
    request,
  }) => {
    expect((await request.get("/api/cron/snapshot")).status()).toBe(401);
  });

  // The pageview recorder is the OTHER deliberately public surface (with share
  // links): the beacon POSTs here without auth. It must NOT 404 — but it must also
  // leak nothing, always answering an empty 204 whatever the input. There is no
  // owner GET route for the stats (the dashboard reads the store inside the never-
  // guest-rendered command center), so there's no new guest-404 route to add.
  test("POST /api/hit is public and returns an empty 204", async ({
    request,
  }) => {
    const res = await request.post("/api/hit", { data: { path: "/" } });
    expect(res.status()).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("POST /api/hit reveals no count even for junk input", async ({
    request,
  }) => {
    for (const data of [{}, { path: "../etc/passwd" }, { path: 123 }]) {
      const res = await request.post("/api/hit", { data });
      expect(res.status()).toBe(204);
      expect(await res.text()).toBe("");
    }
  });

  // The CSP violation collector is the OTHER public recorder (roadmap 37e): the policy
  // points browsers here without auth. Like /api/hit it must NOT 404 and must leak
  // nothing — always the same empty 204 whether the report is valid, junk, or oversized
  // — so a probe can't turn it into an oracle. There is no owner GET route (the panel
  // reads the store inside the never-guest-rendered command center).
  test("POST /api/csp-report always returns an empty 204, no oracle", async ({
    request,
  }) => {
    const legacy = {
      "csp-report": {
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js",
        "document-uri": "https://localhost/notes",
      },
    };
    const cases: unknown[] = [
      legacy, // a valid-looking legacy report
      [{ type: "csp-violation", body: { effectiveDirective: "img-src" } }], // Reporting API
      {}, // junk
      { "csp-report": 123 }, // malformed
      "not json at all", // unparseable
      { big: "x".repeat(64 * 1024) }, // oversized (> 32KB cap)
    ];
    for (const data of cases) {
      const res = await request.post("/api/csp-report", { data });
      expect(res.status(), `body ${JSON.stringify(data).slice(0, 40)}`).toBe(
        204,
      );
      expect(await res.text()).toBe("");
    }
  });
});

/**
 * Fragment-key share links (ADR 0058) — the ONE deliberately public surface. The
 * serve route hands out ciphertext to a bearer (the key is in the URL #fragment,
 * never sent), so it has no auth gate; these lock that it still can't be turned
 * into an oracle or coaxed into serving a non-share blob, and that malformed links
 * 404 rather than probe. In the secretless e2e env the store is off, so every
 * share read collapses to 404 — exactly the guest-facing behaviour.
 */
test.describe("public share links", () => {
  const VALID = `1900000000-e-${"A".repeat(22)}`; // well-formed, far-future expiry

  test("the serve route 404s malformed, expired, traversal, and absent ids alike", async ({
    request,
  }) => {
    for (const id of [
      VALID, // well-formed but no such blob (store off) — no existence oracle
      `1000000000-e-${"A".repeat(22)}`, // expired (2001)
      "not-a-share", // wrong shape
      "..%2fmeta%2fkeystore", // traversal probe
      `1900000000-e-${"A".repeat(21)}`, // id one char short
    ]) {
      const res = await request.get(`/api/share/${id}`);
      expect(res.status(), `share id "${id}" must 404`).toBe(404);
    }
  });

  test("a malformed /s link is a 404 page, not a probe", async ({
    request,
  }) => {
    expect((await request.get("/s/not-a-share")).status()).toBe(404);
  });

  test("a well-formed /s page is public and leaks no owner surface", async ({
    request,
  }) => {
    const res = await request.get(`/s/${VALID}`);
    expect(res.status()).toBe(200); // public by design — recipients aren't the owner
    const html = await res.text();
    expect(html).not.toContain("command center");
    expect(html).not.toContain("net worth");
  });
});

/**
 * Strict CSP, Report-Only (src/proxy.ts). Every non-api HTML response gains a
 * per-request-nonce policy in `content-security-policy-report-only`, layered on
 * top of the UNCHANGED next.config.ts baseline. Locks the policy shape, nonce
 * freshness, the nonce↔markup wiring, and that the proxy leaves the baseline
 * headers byte-identical.
 */
test.describe("strict CSP (report-only)", () => {
  const noncePattern =
    /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/;

  // The proxy runs on the guest 404 response too, so /files carries it as well.
  for (const path of ["/", "/files"]) {
    test(`${path} carries the report-only policy`, async ({ request }) => {
      const csp = (await request.get(path)).headers()[
        "content-security-policy-report-only"
      ];
      expect(csp).toBeDefined();
      expect(csp).toMatch(noncePattern);
      for (const directive of [
        "default-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-src 'none'",
        "worker-src 'self'",
        // The e2e build runs with no R2 env, so the policy is the store-off shape;
        // the with-R2 variant (endpoint origin in connect-src + img-src) is locked
        // by the csp unit tests.
        "connect-src 'self'",
        "img-src 'self' data: blob:",
        "form-action 'self'",
        // First-party violation reporting (roadmap 37e): both directives, same
        // same-origin endpoint — no third-party collector.
        "report-uri /api/csp-report",
        "report-to csp",
      ]) {
        expect(csp, `${path} is missing \`${directive}\``).toContain(directive);
      }
    });
  }

  test("the Reporting-Endpoints header names the first-party csp group", async ({
    request,
  }) => {
    const h = (await request.get("/")).headers();
    expect(h["reporting-endpoints"]).toBe('csp="/api/csp-report"');
  });

  test("two requests mint different nonces", async ({ request }) => {
    const mint = async () =>
      (await request.get("/"))
        .headers()
        ["content-security-policy-report-only"]?.match(noncePattern)?.[1];
    const first = await mint();
    const second = await mint();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  test("the nonce is wired into the HTML", async ({ request }) => {
    const res = await request.get("/");
    const nonce = res
      .headers()
      ["content-security-policy-report-only"]?.match(noncePattern)?.[1];
    expect(nonce).toBeDefined();
    // Proves Next threaded it into the markup, not just the header.
    expect(await res.text()).toContain(`nonce="${nonce}"`);
  });

  test("baseline headers are byte-exact after the proxy", async ({
    request,
  }) => {
    const h = (await request.get("/")).headers();
    // Exact values copied from next.config.ts — the proxy must not touch them.
    expect(h["content-security-policy"]).toBe(
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    );
    expect(h["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(h["x-powered-by"]).toBeUndefined();
  });
});
