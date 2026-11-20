import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, type Browser } from "@playwright/test";

import { signUpOwner, type Account } from "./accounts";
import { totp } from "./totp";

/**
 * Platform roles have no screen by design (OPS-001, tenancy-and-roles.md): an engineer grants them
 * with `npm run ops:grant`. The run script forwards the database and sets E2E_DATABASE_URL for it.
 */
function grant(email: string, role: "platform_admin" | "support_operator"): void {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is not set: run the suite through scripts/test-e2e.sh, which forwards the database for ops:grant.");
  const root = path.resolve(__dirname, "../../..");
  execFileSync("npm", ["--prefix", "apps/web", "run", "ops:grant", "--", email, role], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

export type Operator = Account & { secret: string };

/** A Hiwar staff account with `role`, signed in to the operator portal with 2-step sign-in set up. */
export async function operator(browser: Browser, role: "platform_admin" | "support_operator", name = role === "platform_admin" ? "Platform Admin" : "Support Operator"): Promise<Operator> {
  const account = await signUpOwner(browser, undefined, name);
  grant(account.email, role);
  const { page } = account;
  await page.goto("/ops");
  await expect(page).toHaveURL(/\/two-step\/setup/);
  const secret = (await page.locator(".mono").textContent())!.trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on 2-step sign-in" }).click();
  await expect(page).toHaveURL(/\/conversations/);
  await page.goto("/ops");
  if (/\/two-step/.test(page.url())) {
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.getByRole("navigation", { name: "Operator navigation" })).toBeVisible();
  return { ...account, secret };
}
