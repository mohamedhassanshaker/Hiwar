import { expect, test, type Page } from "@playwright/test";

import { closeContexts, mailText, newPage, signIn, signUpOwner, type Account } from "../support/accounts";
import { operator, type Operator } from "../support/operator";
import { openWidget, readyWorkspace } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

async function openOrg(page: Page, name: string): Promise<void> {
  await page.goto(`/ops?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}
function actions(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Actions", exact: true }) });
}
async function act(page: Page, reason: string, button: string, toast: string): Promise<void> {
  await actions(page).getByLabel("Reason (required)").fill(reason);
  await actions(page).getByRole("button", { name: button }).click();
  await expect(page.getByRole("status").filter({ hasText: toast })).toBeVisible();
}

test.describe("OPS-001 Operator organizations list and actions", () => {
  test.describe.configure({ mode: "serial" });
  let admin: Operator;
  let support: Operator;
  let customer: Account & { org: string };
  let key = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    admin = await operator(browser, "platform_admin");
    support = await operator(browser, "support_operator");
    customer = await signUpOwner(browser, undefined, "Noura Al Suwaidi");
    ({ key } = await readyWorkspace(customer.page));
  });

  test("AC-OPS-001-01: O-Tenants lists organizations with owner, plan, status, AI conversations of the allowance and created date, with search and native selects", async () => {
    const { page } = admin;
    await page.goto("/ops");
    await expect(page.getByRole("table").first().getByRole("columnheader")).toHaveText(["Organization", "Owner", "Plan", "Status", "AI conversations this month", "Created"]);
    await expect(page.getByLabel("Plan").locator("option")).toHaveText(["All plans", "Trial", "Starter", "Growth", "Business", "Enterprise"]);
    await expect(page.getByLabel("Status").locator("option")).toHaveText(["All statuses", "Trial", "Active", "Past due", "Suspended", "Trial ended"]);
    await page.getByPlaceholder("Name or owner email").fill(customer.org);
    await page.getByRole("button", { name: "Filter" }).click();
    const row = page.getByRole("row").filter({ hasText: customer.org });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("cell").nth(1)).toHaveText(customer.email);
    await expect(row.getByRole("cell").nth(2)).toHaveText("Trial");
    await expect(row.locator(".stt")).toHaveText("Trial");
    await expect(row.getByRole("cell").nth(4)).toHaveText(/^\d+ of 100$/);
    await expect(row.getByRole("cell").nth(5)).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    await page.getByLabel("Status").selectOption({ label: "Suspended" });
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("row").filter({ hasText: customer.org })).toHaveCount(0);
  });

  test("AC-OPS-001-02: the detail shows plan and dates, usage, members, deployments with status and origins, payment status and operator actions", async () => {
    const { page } = admin;
    await openOrg(page, customer.org);
    await expect(page.getByText(/^Trial · trial · trial ends \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(page.locator(".card").filter({ hasText: "AI conversations" }).locator(".num")).toHaveText(/\d+/);
    await expect(page.locator(".card").filter({ hasText: "Members" }).locator(".num")).toHaveText("1");
    await expect(page.locator(".card").filter({ hasText: "Payment" })).toContainText("No card");
    const deployments = page.locator("section").filter({ has: page.getByRole("heading", { name: "Deployments" }) });
    await expect(deployments).toContainText("Order site");
    await expect(deployments).toContainText("live");
    await expect(deployments).toContainText(/https:\/\/hiwar\.localtest\.me(:\d+)? ✓/);
    await expect(page.getByRole("heading", { name: "Operator actions" })).toBeVisible();
  });

  test("AC-OPS-001-03: a Support operator sees the detail read-only with no conversation content", async () => {
    const { page } = support;
    await openOrg(page, customer.org);
    await expect(page.getByRole("heading", { name: "Actions", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button")).not.toContainText(["Suspend", "Extend trial", "Set plan"]);
    await expect(page.getByRole("main")).not.toContainText("Do you deliver to Sharjah?");
  });

  test("AC-OPS-001-04: Extend trial by 7 days with a reason moves the trial end and records the reason", async () => {
    const { page } = admin;
    await openOrg(page, customer.org);
    const before = (await page.getByText(/trial ends (\d{4}-\d{2}-\d{2})/).textContent())!.match(/trial ends (\d{4}-\d{2}-\d{2})/)![1];
    await actions(page).getByLabel("Days").fill("7");
    await act(page, "Customer is evaluating with their IT team", "Extend trial", "Trial extended by 7 days.");
    const expected = new Date(Date.parse(before) + 7 * 86_400_000).toISOString().slice(0, 10);
    await expect(page.getByText(`trial ends ${expected}`)).toBeVisible();
    await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "Operator actions" }) })).toContainText("Customer is evaluating with their IT team");
  });

  test("AC-OPS-001-05: Suspend takes the widget offline, members see the suspended message at sign-in, data is kept and the Owner is emailed", async ({ browser }) => {
    const { page } = admin;
    await openOrg(page, customer.org);
    await act(page, "Chargeback under review", "Suspend", "Suspended. The Owner was emailed.");
    const { widget } = await openWidget(browser, key);
    await expect(widget.getByText("We are offline right now", { exact: true })).toBeVisible();
    const member = await newPage(browser);
    await signIn(member, customer.email);
    await expect(member.getByText("This organization is suspended. Contact support.")).toBeVisible();
    expect(await mailText(page, customer.email, /suspend/i)).toMatch(/suspended/i);
  });

  test("AC-OPS-001-06: Reactivate brings widgets and access back as before", async ({ browser }) => {
    const { page } = admin;
    await openOrg(page, customer.org);
    await act(page, "Chargeback resolved", "Reactivate", "Reactivated.");
    const { widget } = await openWidget(browser, key);
    await expect(widget.getByLabel("Write a message")).toBeVisible();
    const member = await newPage(browser);
    await signIn(member, customer.email);
    await expect(member).toHaveURL(/\/conversations/);
    await member.goto("/knowledge");
    await expect(member.getByRole("row").filter({ hasText: "Do you deliver to Sharjah?" })).toBeVisible();
  });

  test("AC-OPS-001-07: Enterprise with custom limits applies them to the organization at once", async () => {
    const { page } = admin;
    await openOrg(page, customer.org);
    await actions(page).getByLabel("Plan").selectOption({ label: "Enterprise" });
    await actions(page).getByLabel("Seats", { exact: true }).fill("7");
    await actions(page).getByLabel("Deployments", { exact: true }).fill("3");
    await act(page, "Signed an Enterprise deal", "Set plan", "Plan set.");
    await expect(page.getByText(/^Enterprise · /)).toBeVisible();
    // Suspension (AC-OPS-001-05) ended the customer's earlier session.
    await signIn(customer.page, customer.email);
    await customer.page.goto("/team");
    await expect(customer.page.getByText("1 of 7 seats used.")).toBeVisible();
    await customer.page.goto("/billing");
    await expect(customer.page.getByRole("progressbar", { name: "Deployments" }).locator("xpath=..")).toContainText(/1 of (3|custom)/);
  });
});
