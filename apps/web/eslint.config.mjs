import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Adapter functions keep the signature the AI module calls and ignore what Hiwar has no use for.
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/widget.js", "test-results/**"]),
]);
