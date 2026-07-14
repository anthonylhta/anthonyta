import { expect, test } from "@playwright/test";

/**
 * /notes pagination — request-driven like the gating suite (no browser). The
 * index is a public crawl surface, so deeper pages must be real links (not
 * client state) and junk page params must clamp, never 5xx. Assertions are
 * structural so they stay green as notes are added weekly.
 */
test.describe("notes pagination", () => {
  test("the index serves page 1 with a real link to page 2", async ({
    request,
  }) => {
    const res = await request.get("/notes");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("/notes?page=2");
  });

  test("page 2 serves and links back to the canonical index", async ({
    request,
  }) => {
    const res = await request.get("/notes?page=2");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/notes"');
    expect(html).not.toContain("/notes?page=1");
  });

  test("out-of-range and junk page params clamp, never break", async ({
    request,
  }) => {
    for (const q of ["?page=9999", "?page=0", "?page=-3", "?page=abc"]) {
      const res = await request.get(`/notes${q}`);
      expect(res.status(), q).toBe(200);
    }
  });
});
