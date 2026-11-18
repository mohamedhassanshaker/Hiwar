import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The measurements, which are not part of the gate.
 *
 * `vitest.config.ts` includes `tests/**` + `.test.ts`, so a file named `.measure.ts` never
 * runs with the suites. This config runs those files and nothing else:
 *
 *     DATABASE_URL=… npx vitest run --config vitest.measure.config.ts
 *
 * They report numbers rather than asserting budgets. A latency assertion would pass or fail
 * on how busy the machine is, which says nothing about the code under it.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/measure/*.measure.ts"],
    fileParallelism: false,
    // The point of a measurement is the table it prints, so it goes straight to the
    // terminal rather than into the reporter's per-test capture.
    disableConsoleIntercept: true,
    // A measurement takes its samples; the budget it reports on is in the hundreds of
    // milliseconds and there are tens of screens.
    testTimeout: 600_000,
  },
});
