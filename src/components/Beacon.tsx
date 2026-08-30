"use client";

import { useEffect } from "react";
import { isSourceTag } from "@/lib/analytics";

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
      // A handed-out link may carry `?s=seek` so the owner can tell which one was
      // opened. Only a well-formed tag rides along — the rest of the query string
      // never leaves the browser, since the recorder stores paths, not URLs.
      const payload: { path: string; s?: string } = { path: location.pathname };
      const s = new URLSearchParams(location.search).get("s");
      if (isSourceTag(s)) payload.s = s;
      void fetch("/api/hit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // navigator gone / fetch unavailable — nothing to do
    }
  }, []);
  return null;
}
