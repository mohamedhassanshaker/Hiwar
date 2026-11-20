import { expect, test } from "@playwright/test";

import { closeContexts, signIn } from "../support/accounts";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

/** The demo organization `make seed` loads (apps/web/src/db/seed.ts); read only here. */
test.describe("PLT-006 Personas, sample data and prototype behaviour", () => {
  test("AC-PLT-006-01: the seed is Gulf Bites Restaurants on Growth with Layla v7 and Salim v3 live, Rana draft, and three deployments", async ({ page }) => {
    await signIn(page, "noura.demo@gulfbites.example", "demo-password-1");
    await expect(page).toHaveURL(/\/conversations/);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.locator(".org-chip")).toContainText("Gulf Bites Restaurants");
    await expect(nav.locator(".org-chip")).toContainText("Growth plan");

    await page.goto("/agents");
    const agents = page.getByRole("complementary", { name: "Agents" }).getByRole("listitem");
    await expect(agents.filter({ hasText: "Layla" }).locator(".stt")).toHaveText("v7 live");
    await expect(agents.filter({ hasText: "Salim" }).locator(".stt")).toHaveText("v3 live");
    await expect(agents.filter({ hasText: "Rana" }).locator(".stt")).toHaveText("Draft");

    await page.goto("/deployments");
    await page.getByRole("complementary", { name: "Deployments" }).getByRole("listitem").filter({ hasText: "Catering page" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Catering page" })).toBeVisible();
    const deployments = page.getByRole("complementary", { name: "Deployments" }).getByRole("listitem");
    await expect(deployments.filter({ hasText: "Order site · Dubai" }).locator(".stt")).toHaveText("Live");
    await expect(deployments.filter({ hasText: "Catering page" }).locator(".stt")).toHaveText("Live");
    await expect(deployments.filter({ hasText: "Arabic landing page" }).locator(".stt")).toHaveText("Draft");
    await page.getByRole("tab", { name: "Behavior and quotas" }).click();
    await expect(page.getByLabel("Agent version").locator("option:checked")).toHaveText("Pin to version 3");
  });
});
