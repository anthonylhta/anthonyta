import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node CommonJS tooling scripts — intentionally use require(); not app code.
    "**/*.cjs",
    // pdf.js runtime assets copied from node_modules on postinstall — vendor code.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
