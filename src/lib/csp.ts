/**
 * Pure builders for the hub's strict, nonce-based Content-Security-Policy. No
 * `next/*` import and no request access — proxy.ts mints a nonce per request and
 * hands it here — so this layer is unit-testable on its own (mirrors lib/files).
 *
 * Shipped Report-Only by default (`cspHeaderName(false)`); a single env flip flips
 * it to enforce.
 */

/**
 * The full policy for one request's `nonce`. Directives are `; `-joined, no trailing
 * semicolon. `dev` adds `'unsafe-eval'` to script-src only (Turbopack HMR needs it).
 */
export function buildCsp(nonce: string, opts?: { dev?: boolean }): string {
  // Nonce + strict-dynamic IS the XSS defense: only our own <script> tags (stamped
  // with this per-request nonce) execute, and anything they inject inherits trust —
  // an injected inline <script> without the nonce can't run.
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(opts?.dev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  const directives = [
    "default-src 'self'",
    `script-src ${script}`,
    // Styles stay 'unsafe-inline': Tailwind v4 + next/font inject inline styles, and
    // styles aren't the injection vector scripts are — the nonce guards the scripts.
    "style-src 'self' 'unsafe-inline'",
    // `blob:` for client-decrypted images (E2EE vault notes + inbox thumbnails render
    // decrypted bytes as object URLs). The private blob host is named because CSP
    // validates the REDIRECT TARGET of the legacy-thumbnail 302s, not only the URL.
    "img-src 'self' data: blob: https://*.private.blob.vercel-storage.com",
    "font-src 'self'",
    // The @vercel/blob client uploads to vercel.com/api/blob/ (verified from dist —
    // NOT the storage host), so client uploads need it in connect-src.
    "connect-src 'self' https://vercel.com/api/blob/",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    // frame-ancestors + form-action duplicate the baseline config so this policy is
    // standalone-complete — it doesn't lean on a header merged in elsewhere.
    "frame-ancestors 'none'",
    "form-action 'self'",
  ];

  return directives.join("; ");
}

/** The header name to emit under: enforce → blocking, else Report-Only (the default). */
export function cspHeaderName(
  enforce: boolean,
): "Content-Security-Policy" | "Content-Security-Policy-Report-Only" {
  return enforce
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}
