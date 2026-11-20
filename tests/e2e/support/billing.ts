import { expect, type Page } from "@playwright/test";

/** The local payment form: save a Visa card ending 4242 (BIL-001). */
export async function addCard(page: Page): Promise<void> {
  await page.goto("/billing");
  await page.getByRole("button", { name: /Add card|Update card/ }).click();
  await page.getByLabel(/Card number/).fill("4242424242424242");
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.getByText("Visa ending 4242")).toBeVisible();
}

export function planCard(page: Page, plan: string) {
  return page.getByRole("region", { name: "Choose a plan" }).locator(".card").filter({ has: page.locator("span.b", { hasText: new RegExp(`^${plan}$`) }) });
}

/** Leave the trial for `plan` (Upgrade from the trial applies today). */
export async function choosePlan(page: Page, plan: "Starter" | "Growth" | "Business"): Promise<void> {
  await page.goto("/billing");
  if (!(await page.getByText("Visa ending 4242").isVisible())) await addCard(page);
  await planCard(page, plan).getByRole("button").click();
  await page.getByRole("dialog", { name: `Change to ${plan}` }).getByRole("button", { name: "Confirm" }).click();
  await expect(planCard(page, plan).getByRole("button", { name: "Current plan" })).toBeVisible();
}
