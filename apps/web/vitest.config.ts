import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: "postgresql://hiwar:hiwar@localhost:5433/hiwar_test", SMTP_URL: "smtp://localhost:1025" },
    // The database suites share one PostgreSQL, so files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
