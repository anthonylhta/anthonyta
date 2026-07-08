import { expect, test } from "@playwright/test";

/**
 * PWA surfaces — the install-to-home-screen wiring must actually serve. All
 * HTTP-observable, so request-driven like the gating suite (no browser). These
 * lock that the manifest, the service worker, the icon routes, and the offline
 * shell stay reachable and don't quietly regress.
 */
test.describe("pwa", () => {
  test("the manifest is served and installs standalone", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe("#0e0d0b");
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons.length).toBeGreaterThan(0);
  });

  test("the manifest link is advertised in the lobby head", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain("manifest.webmanifest");
  });

  test("the service worker is served as JavaScript", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("javascript");
    expect(await res.text()).toContain("addEventListener");
  });

  test("the icon routes render PNGs", async ({ request }) => {
    for (const spec of ["192", "512", "maskable-192", "maskable-512"]) {
      const res = await request.get(`/icons/${spec}`);
      expect(res.status(), spec).toBe(200);
      expect(res.headers()["content-type"], spec).toContain("image/png");
    }
  });

  test("an unknown icon spec is a 404", async ({ request }) => {
    expect((await request.get("/icons/999")).status()).toBe(404);
  });

  test("the offline fallback renders standalone", async ({ request }) => {
    const res = await request.get("/offline");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("no connection");
  });
});
