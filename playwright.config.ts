import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against the real application. Needs `docker compose --profile agent up -d`
 * and `ALLOW_PRIVATE_EGRESS=1` in apps/web/.env.local, so the local demo page can be verified.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  // BASE_URL runs the suite against a deployment, such as the kind cluster, whose certificate
  // the local CA signs; without it the suite starts the dev server.
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    ignoreHTTPSErrors: Boolean(process.env.BASE_URL),
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm --prefix apps/web run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
