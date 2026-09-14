import type { NextConfig } from "next";

/**
 * Baseline HTTP hardening. Next ships no security headers by default and Vercel
 * adds none beyond TLS, so set them here (they apply in `next dev` too).
 *
 * The CSP is deliberately limited to directives that can't break rendering —
 * `frame-ancestors` (clickjacking), `base-uri`, and `form-action`. A full
 * `script-src` / `style-src` policy needs per-request nonces (Next injects inline
 * hydration scripts, Tailwind injects inline styles), so that's left to a separate
 * change rather than shipping a nonce-less policy that would silently break the app.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    // `preload` opts anthonyta.dev into browser HSTS preload lists: serving the
    // token is itself consent (third parties can submit it), and removal from
    // the list takes months — a deliberate one-way door. The hstspreload.org
    // submission stays a manual owner step. Requires includeSubDomains, so
    // every *.anthonyta.dev must stay HTTPS-only (all subdomains are on Vercel).
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Drop the `X-Powered-By: Next.js` fingerprint.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The tone-translator → ishin rebrand renamed two public routes; 308-redirect
  // the old paths so existing links, bookmarks, and search results don't 404.
  //
  // `/live` is not a page but a name for the lobby's folded-open state, so it
  // redirects onto the fragment the fold reads on mount. A CONFIG redirect
  // rather than a page.tsx, deliberately: a route file would join the app's
  // route tree (and so the adversarial suite's manifest) to do nothing but
  // bounce, and it would have to be argued in and out of the sitemap. 307, not
  // 308 — a browser-cached-forever alias would be the wrong thing to have
  // promised if /live ever becomes a page of its own.
  async redirects() {
    return [
      { source: "/translator", destination: "/ishin", permanent: true },
      {
        source: "/projects/tone-translator",
        destination: "/projects/ishin",
        permanent: true,
      },
      { source: "/live", destination: "/#live", permanent: false },
    ];
  },
};

export default nextConfig;
