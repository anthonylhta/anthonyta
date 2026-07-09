import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * Web App Manifest — makes the hub installable to a phone's home screen so it
 * opens standalone (no browser chrome, no typing the URL). Next serves this at
 * `/manifest.webmanifest` and auto-injects the `<link rel="manifest">`.
 *
 * Icons come from the generated routes in app/icons/[icon] (one renderer, in
 * lib/pwa) and cover both `any` and Android's `maskable` purpose. `start_url`
 * and the shortcuts carry `?source=pwa` so an installed launch is legible in
 * analytics and distinct from a browser visit. Shortcuts are the long-press
 * jump-list — the three public daily surfaces, never an owner-gated route.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${SITE_NAME} — hub`,
    short_name: "anthony ta",
    description: SITE_DESCRIPTION,
    lang: "en-AU",
    dir: "ltr",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    theme_color: "#0e0d0b",
    background_color: "#0e0d0b",
    categories: ["productivity", "finance", "education"],
    icons: [
      {
        src: "/icons/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "briefing", short_name: "briefing", url: "/briefing?source=pwa" },
      { name: "today's hand", short_name: "riichi", url: "/riichi?source=pwa" },
      {
        name: "tone translator",
        short_name: "translator",
        url: "/translator?source=pwa",
      },
    ],
    // Android share sheet → the owner-only files inbox. Sharing a file to the
    // installed app POSTs it to the share route, which stores it and redirects.
    share_target: {
      action: "/api/files/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: "file", accept: ["*/*"] }] },
    },
  };
}
