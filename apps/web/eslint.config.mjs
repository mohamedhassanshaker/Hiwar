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
    // The vendored design system and the module generated from it are never hand-edited.
    "vendor/**",
    "src/ds/generated/**",
    // Playwright's output, including the bundled trace viewer of its HTML report.
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
