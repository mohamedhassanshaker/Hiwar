import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // `.tsx` as well, because the component cases render through `react-dom/server`.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // The database-backed suites seed and write against one real PostgreSQL, so the files
    // run one after another rather than in parallel threads.
    fileParallelism: false,
    testTimeout: 30_000,
    // Auth.js imports `next/server` without an extension, which Node's ESM resolver refuses;
    // inlining it lets Vite resolve the import, so the auth route can be loaded as shipped.
    server: { deps: { inline: ["next-auth"] } },
  },
});
