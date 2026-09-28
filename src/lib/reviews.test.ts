import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Spoiler } from "@/components/SpoilerFold";
import { novels } from "./novels";
import { reviews } from "./reviews";

const IDS = [
  "verdict",
  "pitch",
  "about",
  "works",
  "doesnt",
  "who",
  "stuck",
  "practical",
  "reread",
];

function countSpoilers(node: ReactNode): number {
  if (Array.isArray(node))
    return node.reduce((n: number, c: ReactNode) => n + countSpoilers(c), 0);
  if (!isValidElement(node)) return 0;
  const props = node.props as { children?: ReactNode };
  return (node.type === Spoiler ? 1 : 0) + countSpoilers(props.children);
}

describe("reviews", () => {
  it("links every review to a shelf row", () => {
    const titles = new Set(novels.map((n) => n.en));
    for (const r of reviews) expect(titles.has(r.novel)).toBe(true);
  });

  it("keeps slugs unique", () => {
    const slugs = reviews.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("carries the nine sections in order", () => {
    for (const r of reviews) expect(r.sections.map((s) => s.id)).toEqual(IDS);
  });

  it("puts at least one fold in a review marked for spoilers", () => {
    for (const r of reviews) {
      const n = r.sections.reduce((t, s) => t + countSpoilers(s.body), 0);
      if (r.spoilers) expect(n).toBeGreaterThan(0);
      else expect(n).toBe(0);
    }
  });
});
