import { renderAppIcon } from "@/lib/pwa";

/**
 * The iOS home-screen icon. Next serves this at a hashed URL and auto-injects
 * the `<link rel="apple-touch-icon">`. iOS rounds the corners itself and never
 * masks, so this is the full-bleed (non-maskable) art at Apple's 180px size.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180, false);
}
