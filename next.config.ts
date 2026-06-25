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
    value:
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Drop the `X-Powered-By: Next.js` fingerprint.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
