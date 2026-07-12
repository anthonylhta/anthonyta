"use client";

import { useEffect } from "react";

/**
 * Fires one cookieless pageview to /api/hit on mount, then renders nothing. A bundled
 * client component (no inline script) so it loads under the strict-dynamic + nonce
 * CSP; the POST is same-origin, so it needs no new CSP origin. Harmless in the public
 * layout for the owner too — the route ignores crawlers, DNT, and the owner's own
 * session server-side. Best-effort: a failed or offline beacon is a silent no-op,
 * never a visible error.
 */
export function Beacon() {
  useEffect(() => {
    try {
      void fetch("/api/hit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: location.pathname }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // navigator gone / fetch unavailable — nothing to do
    }
  }, []);
  return null;
}
