import { expect, test, type Page } from "@playwright/test";

import { closeContexts, mailLink, password, unique } from "../support/accounts";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function card(page: Page, plan: string) {
  return page.locator(".card").filter({ has: page.locator("b.h3", { hasText: new RegExp(`^${plan}$`) }) });
}

test.describe("WEB-002 Public pricing page", () => {
  test("AC-WEB-002-01: one product, four plans, Growth marked Most chosen, no audience tabs", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator("b.h3")).toHaveText(["Starter", "Growth", "Business", "Enterprise"]);
    await expect(card(page, "Growth").getByText("Most chosen")).toBeVisible();
    await expect(page.getByText("Most chosen")).toHaveCount(1);
    await expect(page.getByRole("tab")).toHaveCount(0);
  });

  test("AC-WEB-002-02: Pay yearly switches between yearly and monthly prices; Enterprise is Custom; VAT note shows", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("Prices exclude 5% VAT.")).toBeVisible();
    const monthly: [string, string][] = [["Starter", "AED 199"], ["Growth", "AED 799"], ["Business", "AED 2,999"]];
    for (const [plan, price] of monthly) {
      await expect(card(page, plan).locator(".num")).toHaveText(price);
      await expect(card(page, plan).getByText("a month", { exact: true })).toBeVisible();
    }
    await expect(card(page, "Enterprise").locator(".num")).toHaveText("Custom");
    await expect(card(page, "Enterprise").getByText("yearly contract")).toBeVisible();

    await page.getByRole("switch", { name: "Pay yearly" }).click();
    const yearly: [string, string][] = [["Starter", "AED 1,990"], ["Growth", "AED 7,990"], ["Business", "AED 29,990"]];
    for (const [plan, price] of yearly) {
      await expect(card(page, plan).locator(".num")).toHaveText(price);
      await expect(card(page, plan).getByText("a year, billed once")).toBeVisible();
    }
    await expect(card(page, "Enterprise").locator(".num")).toHaveText("Custom");

    await page.getByRole("switch", { name: "Pay yearly" }).click();
    await expect(card(page, "Starter").locator(".num")).toHaveText("AED 199");
  });

  test("AC-WEB-002-03: each P2 item carries a Planned badge", async ({ page }) => {
    await page.goto("/pricing");
    for (const item of ["Copilot mode", "Webhooks and public API", "Single sign-on", "Scheduled reports", "Regional data hosting", "White label"]) {
      const row = page.getByRole("listitem").filter({ hasText: item });
      await expect(row.getByText("Planned", { exact: true })).toBeVisible();
    }
  });

  test("AC-WEB-002-04: Start free on a plan opens sign-up and starts a 14-day trial with no card", async ({ page }) => {
    await page.goto("/pricing");
    await card(page, "Business").getByRole("link", { name: "Start free" }).click();
    await expect(page).toHaveURL(/\/sign-up$/);
    const email = `${unique("pricing")}@e2e.local`;
    await page.getByLabel("Your name").fill("Pricing Visitor");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByLabel("Organization name").fill(unique("Pricing Org"));
    await page.getByRole("button", { name: "Start free" }).click();
    await page.goto(await mailLink(page, email, "verify-email"));
    await expect(page.getByText("Trial · 14 days left")).toBeVisible();
    await page.goto("/billing");
    await expect(page.getByText(/No card/i).first()).toBeVisible();
  });

  test("AC-WEB-002-05: Talk to us on Enterprise sends the contact form and confirms", async ({ page }) => {
    await page.goto("/pricing");
    await card(page, "Enterprise").getByRole("button", { name: "Talk to us" }).click();
    const dialog = page.getByRole("dialog", { name: "Talk to us about Enterprise" });
    await dialog.getByLabel("Name").fill("Sales Visitor");
    await dialog.getByLabel("Work email").fill(`${unique("sales")}@e2e.local`);
    await dialog.getByLabel("Company").fill("E2E Holdings");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Our team will email you within 1 working day to talk about limits, hosting and an SLA.");
  });

  test("AC-WEB-002-06: opening an FAQ question expands its answer and collapses the open one", async ({ page }) => {
    await page.goto("/pricing");
    const first = page.getByRole("button", { name: "What counts as an AI conversation?" });
    const second = page.getByRole("button", { name: "What happens when I reach a limit?" });
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Replies from your team are free.", { exact: false })).toBeVisible();
    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("You choose. By default the widget shows your fallback message")).toBeVisible();
    await expect(page.getByText("Replies from your team are free.", { exact: false })).toBeHidden();
  });
});
