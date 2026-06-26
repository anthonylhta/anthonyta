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
    },
  },
});
