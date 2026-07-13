import { defineConfig } from "@playwright/test";

/**
 * E2E gating tests (ADR 0045). Request-driven — the security invariants are all
 * HTTP-observable (status, body, headers, redirects), so no browser is launched
 * and no `playwright install` is needed. The webServer builds nothing; it runs the
 * already-built app (`next start`) — CI builds in an earlier step, and locally you
 * `npm run build` first. NODE_OPTIONS carries the WSL/Neon IPv4 workaround so the
 * lobby's connectors don't stall locally.
 */
const PORT = 3210;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL },
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      NODE_OPTIONS:
        "--dns-result-order=ipv4first --no-network-family-autoselection",
      // Throwaway auth config so the app boots in a valid state under test (no
      // secrets in CI). These are NOT real credentials and never authenticate
      // anyone — the suite is guest-only; they just stop Auth.js erroring on boot.
      AUTH_SECRET: "e2e-throwaway-secret-not-a-real-credential",
      AUTH_GITHUB_ID: "e2e",
      AUTH_GITHUB_SECRET: "e2e",
      // Pin the WRITE-capable stores OFF so a local run matches secretless CI.
      // `next start` loads the developer's .env/.env.local, and the suite POSTs
      // fixture bodies at the public recorders (/api/hit, /api/csp-report) — with
      // real R2 creds in scope those folded a fake "evil.example" violation into
      // LIVE telemetry. Empty strings win over .env values (Next never overrides
      // an existing env var), and empty reads as unconfigured everywhere
      // (r2Enabled, the ingest gate).
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      R2_BUCKET: "",
      BRIEFING_INGEST_SECRET: "",
    },
  },
});
