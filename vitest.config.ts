import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // The adversarial e2e corpus is pinned by a vitest suite that lives beside it in
    // e2e/. `.vitest.ts` (not `.test.ts`/`.spec.ts`) keeps Playwright from also
    // trying to run it as a browser spec.
    include: ["src/**/*.test.ts", "e2e/**/*.vitest.ts"],
  },
});
