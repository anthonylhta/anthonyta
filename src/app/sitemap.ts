import type { MetadataRoute } from "next";
import { reviews } from "@/lib/reviews";
import { PUBLIC_ROUTES, SITE_URL } from "@/lib/site";

/**
 * Sitemap — PUBLIC routes only (the list is owner-page-free by construction, see
 * lib/site). The home page leads; everything else is weekly-ish. No owner-gated
 * paths, so the private mode stays invisible (ADR 0022).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...PUBLIC_ROUTES, ...reviews.map((r) => `/novels/${r.slug}`)];
  return paths.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" ? "daily" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
