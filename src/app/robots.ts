import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * robots.txt — allow the public site, keep crawlers out of `/api`, and point at
 * the sitemap. We deliberately DON'T `Disallow: /vault` or `/portfolio`: listing
 * them would announce that they exist. They already 404 for guests, so they never
 * get indexed — omission is the right way to keep the private mode hidden (ADR 0022).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
