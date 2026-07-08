import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES } from "@/lib/site";
import manifest from "./manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("installs standalone with the warm-terminal shell colors", () => {
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe("#0e0d0b");
    expect(m.background_color).toBe("#0e0d0b");
    expect(m.scope).toBe("/");
    expect(m.start_url).toContain("/");
  });

  it("ships both an any and a maskable icon at 192 and 512", () => {
    const icons = m.icons ?? [];
    const purposes = icons.map((i) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
    for (const size of ["192x192", "512x512"]) {
      expect(icons.some((i) => i.sizes === size)).toBe(true);
    }
    // Every icon points at the generated /icons route and is a PNG.
    for (const icon of icons) {
      expect(icon.src).toMatch(/^\/icons\//);
      expect(icon.type).toBe("image/png");
    }
  });

  it("only links shortcuts to public, non-owner routes (ADR 0022)", () => {
    const shortcuts = m.shortcuts ?? [];
    expect(shortcuts.length).toBeGreaterThan(0);
    for (const s of shortcuts) {
      const path = new URL(s.url, "https://anthonyta.dev").pathname;
      expect(PUBLIC_ROUTES).toContain(path);
      expect(path).not.toMatch(/^\/(vault|portfolio)/);
    }
  });
});
