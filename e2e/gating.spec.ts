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

  test("PUT /api/files/keystore is 404 for a guest", async ({ request }) => {
    const res = await request.put("/api/files/keystore", { data: { v: 1 } });
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

  test("POST /api/files/share is 404 for a guest", async ({ request }) => {
    const res = await request.post("/api/files/share");
    expect(res.status()).toBe(404);
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
});
