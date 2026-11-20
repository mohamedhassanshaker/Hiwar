import { expect, test, type Page } from "@playwright/test";

import { closeContexts, newPage, signUpOwner } from "../support/accounts";
import { choosePlan, planCard } from "../support/billing";
import { operator, type Operator } from "../support/operator";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function editor(page: Page, plan: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: plan, exact: true }) });
}

/** Save a new version of `plan` with `change` applied, and return a function that restores the values it replaced. */
async function savePlan(page: Page, plan: string, change: Record<string, string>, reason: string, applyNow = false): Promise<() => Promise<void>> {
  await page.goto("/ops/plans");
  const card = editor(page, plan);
  const previous: Record<string, string> = {};
  for (const [label, value] of Object.entries(change)) {
    const input = card.getByLabel(label, { exact: true });
    previous[label] = await input.inputValue();
    await input.fill(value);
  }
  await card.getByPlaceholder("Reason for the change").fill(reason);
  if (applyNow) await card.getByRole("checkbox", { name: "Apply a limit increase to existing customers now" }).check();
  await card.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("status").filter({ hasText: new RegExp(`^${plan} version \\d+ saved\\.$`) })).toBeVisible();
  return async () => {
    await page.goto("/ops/plans");
    const again = editor(page, plan);
    for (const [label, value] of Object.entries(previous)) await again.getByLabel(label, { exact: true }).fill(value);
    await again.getByPlaceholder("Reason for the change").fill("Restore after the end-to-end test");
    await again.getByRole("button", { name: "Save version" }).click();
    await expect(page.getByRole("status").filter({ hasText: new RegExp(`^${plan} version \\d+ saved\\.$`) })).toBeVisible();
  };
}

test.describe("OPS-002 Operator plans and prices", () => {
  test.describe.configure({ mode: "serial" });
  let admin: Operator;

  test.beforeAll(async ({ browser }) => {
    admin = await operator(browser, "platform_admin");
  });

  test("AC-OPS-002-01: O-Plans lists every plan with prices, allowance, overage, limits, models, tools and trial length", async () => {
    const { page } = admin;
    await page.goto("/ops/plans");
    for (const plan of ["Trial", "Starter", "Growth", "Business", "Enterprise"]) {
      const card = editor(page, plan);
      await expect(card).toBeVisible();
      for (const field of ["Monthly AED", "Yearly AED", "Overage AED per AI conversation", "Trial days", "aiConversations", "agents", "deployments", "seats", "storageGb"]) {
        await expect(card.getByLabel(field, { exact: true })).toBeVisible();
      }
      for (const box of ["fast model", "standard model", "advanced model", "HTTP tools"]) await expect(card.getByRole("checkbox", { name: box })).toBeVisible();
    }
    const growth = editor(page, "Growth");
    await expect(growth.getByLabel("Monthly AED", { exact: true })).toHaveValue("799");
    await expect(growth.getByLabel("Yearly AED", { exact: true })).toHaveValue("7990");
    await expect(growth.getByLabel("aiConversations", { exact: true })).toHaveValue("2000");
    await expect(editor(page, "Trial").getByLabel("Trial days", { exact: true })).toHaveValue("14");
  });

  test("AC-OPS-002-02, -03: a saved Growth change is a new version shown at once on Pricing and Choose a plan, while an existing Growth customer keeps their price", async ({ browser }) => {
    const existing = await signUpOwner(browser);
    await choosePlan(existing.page, "Growth");
    const restore = await savePlan(admin.page, "Growth", { "Monthly AED": "811" }, "Price review");
    try {
      const visitor = await newPage(browser);
      await visitor.goto("/pricing");
      await expect(visitor.locator(".card").filter({ has: visitor.locator("b.h3", { hasText: /^Growth$/ }) }).locator(".num")).toHaveText("AED 811");
      const fresh = await signUpOwner(browser);
      await fresh.page.goto("/billing");
      await expect(planCard(fresh.page, "Growth")).toContainText("AED 811");
      await existing.page.goto("/billing");
      await expect(planCard(existing.page, "Growth").getByRole("button", { name: "Current plan" })).toBeVisible();
      await expect(existing.page.getByRole("region", { name: "Usage this period" })).toContainText("Growth plan");
    } finally {
      await restore();
    }
  });

  test.fixme("AC-OPS-002-03: an existing customer gets the new version at renewal after an email notice at least 30 days before (needs a server clock)", async () => {});

  test("AC-OPS-002-04: a limit increase saved with 'Apply to existing customers now' raises existing customers' limits at once without a price change", async ({ browser }) => {
    const existing = await signUpOwner(browser);
    await choosePlan(existing.page, "Growth");
    await existing.page.goto("/team");
    await expect(existing.page.getByText("1 of 10 seats used.")).toBeVisible();
    const restore = await savePlan(admin.page, "Growth", { seats: "12" }, "More seats for Growth", true);
    try {
      await existing.page.goto("/team");
      await expect(existing.page.getByText("1 of 12 seats used.")).toBeVisible();
      await existing.page.goto("/billing");
      await expect(planCard(existing.page, "Growth")).toContainText("AED 799");
    } finally {
      await restore();
    }
  });
});
