import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildCsp, cspHeaderName, reportingEndpointsHeader } from "@/lib/csp";
import { r2Origin } from "@/lib/r2";

/**
 * Per-request nonce + strict CSP, wired the way Next's own CSP guide prescribes
 * (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
 *
 * Report-Only first (the guarded default). With `CSP_ENFORCE` unset the browser
 * only *reports* violations, never blocks — so the first deploy of a strict policy
 * can't break the app. Flip to enforcing with a single env var: `CSP_ENFORCE=1`.
 * Nothing else changes; the report-only build already reports exactly what the
 * enforcing build would block, because both emit the identical policy string.
 *
 * The request-header trick: Next auto-stamps this nonce onto its own framework /
 * hydration inline scripts by parsing the `Content-Security-Policy` REQUEST header
 * during SSR (it extracts the `'nonce-…'` value). So we set that header — under the
 * enforcement name, always, in both modes — on the cloned request. The *response*
 * header name is the one that flips (enforce vs Report-Only); the request header
 * must stay `Content-Security-Policy` or Next won't find the nonce.
 *
 * Inbound `x-nonce` / `Content-Security-Policy` request headers are overwritten, not
 * merged: a client could spoof them to smuggle its own nonce into our SSR. `.set()`
 * (not `.append()`) guarantees the value downstream is the one we minted here.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    r2Origin: r2Origin(),
  });

  // Clone inbound headers, then overwrite ours so a spoofed x-nonce can't survive.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Always the enforcement name on the request — this is what Next parses to
  // auto-nonce its inline scripts, independent of how we report on the response.
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // The one line the env flag touches: Report-Only by default, blocking at CSP_ENFORCE=1.
  response.headers.set(cspHeaderName(process.env.CSP_ENFORCE === "1"), policy);
  // Defines the same-origin `csp` group the policy's `report-to` directive names, so
  // Reporting-API browsers deliver violations first-party (roadmap 37e).
  response.headers.set("Reporting-Endpoints", reportingEndpointsHeader());

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
