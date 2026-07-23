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

/**
 * Tag filter — same crawl-surface rules as the pager: filtered views are real
 * server-rendered anchors, junk never errors, and an unknown tag reads as the
 * unfiltered index (no thin/empty pages for probes to mint).
 */
test.describe("notes tags", () => {
  test("the index serves the chip row with real tag links", async ({
    request,
  }) => {
    const res = await request.get("/notes");
    expect(res.status()).toBe(200);
    const html = await res.text();
    for (const t of ["agents", "e2ee", "engineering"])
      expect(html).toContain(`href="/notes?tag=${t}"`);
  });

  test("a filtered view narrows the list and echoes the filter", async ({
    request,
  }) => {
    const res = await request.get("/notes?tag=e2ee");
    expect(res.status()).toBe(200);
    const html = await res.text();
    // The prompt echoes the command form…
    expect(html).toContain("--tag");
    // …an e2ee note is present, an agents note is not.
    expect(html).toContain("/notes/one-store-every-door");
    expect(html).not.toContain("/notes/keep-the-model-in-its-lane");
    // Escaping the filter is a real link back to the canonical index.
    expect(html).toContain('href="/notes"');
  });

  test("an unknown tag reads as the unfiltered index, never an error", async ({
    request,
  }) => {
    for (const q of ["?tag=zzz", "?tag=", "?tag=%2e%2e", "?tag=E2EE"]) {
      const res = await request.get(`/notes${q}`);
      expect(res.status(), q).toBe(200);
      const html = await res.text();
      expect(html, q).toContain("/notes/keep-the-model-in-its-lane");
    }
  });

  test("the filter composes with the pager", async ({ request }) => {
    // engineering holds 9+ notes but under a page — the filtered page 1 must
    // not advertise a deeper page; the unfiltered index must.
    const res = await request.get("/notes?tag=engineering");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("tag=engineering&page=2");
  });
});
