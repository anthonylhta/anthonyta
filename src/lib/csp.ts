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
 * `r2Origin` is the R2 endpoint origin when the store is configured (proxy.ts reads
 * it off the env) — absent, the policy simply omits it (local dev, CI).
 */
export function buildCsp(
  nonce: string,
  opts?: { dev?: boolean; r2Origin?: string | null },
): string {
  // Nonce + strict-dynamic IS the XSS defense: only our own <script> tags (stamped
  // with this per-request nonce) execute, and anything they inject inherits trust —
  // an injected inline <script> without the nonce can't run.
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(opts?.dev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  // The R2 endpoint origin joins the policy only when the store is configured.
  const r2 = opts?.r2Origin ? ` ${opts.r2Origin}` : "";

  const directives = [
    "default-src 'self'",
    `script-src ${script}`,
    // Styles stay 'unsafe-inline': Tailwind v4 + next/font inject inline styles, and
    // styles aren't the injection vector scripts are — the nonce guards the scripts.
    "style-src 'self' 'unsafe-inline'",
    // `blob:` for client-decrypted images (E2EE vault notes + inbox thumbnails render
    // decrypted bytes as object URLs). The R2 origin is named because CSP validates
    // the REDIRECT TARGET of the legacy-thumbnail 302s, not only the URL.
    `img-src 'self' data: blob:${r2}`,
    "font-src 'self'",
    // Uploads PUT ciphertext straight to the bucket on presigned URLs (ADR 0060),
    // so the R2 origin joins connect-src; reads stay same-origin via the raw proxies.
    `connect-src 'self'${r2}`,
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
