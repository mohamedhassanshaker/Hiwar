import { expect, test, type Page } from "@playwright/test";

import { closeContexts, signUpOwner, type Account } from "../support/accounts";
import { operator, type Operator } from "../support/operator";
import { readyWorkspace, waitingConversation } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

async function grantAccess(page: Page, includeConversations: boolean): Promise<void> {
  await page.goto("/team");
  await page.getByRole("button", { name: "Grant support access" }).click();
  const dialog = page.getByRole("dialog", { name: "Grant support access" });
  await dialog.getByLabel("For").selectOption({ label: "24 hours" });
  if (includeConversations) await dialog.getByRole("checkbox", { name: "Include conversation content" }).check();
  await dialog.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Support access granted." })).toBeVisible();
}
function grantRow(page: Page, org: string) {
  return page.getByRole("row").filter({ hasText: org });
}

test.describe("OPS-003 Time-limited support access", () => {
  test.describe.configure({ mode: "serial" });
  let support: Operator;
  let customer: Account & { org: string };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    support = await operator(browser, "support_operator");
    customer = await signUpOwner(browser);
    const { key } = await readyWorkspace(customer.page);
    await waitingConversation(browser, key);
  });

  test("AC-OPS-003-05: with no grant the operator cannot open the control panel", async () => {
    const { page } = support;
    await page.goto("/ops/support");
    await page.getByRole("tab", { name: "Support access" }).click();
    await expect(grantRow(page, customer.org)).toHaveCount(0);
    const { page: panel } = support;
    await panel.goto("/conversations");
    await expect(panel.getByText("Hiwar support · read-only")).toHaveCount(0);
    await expect(panel.getByRole("navigation", { name: "Main navigation" })).not.toContainText(customer.org);
  });

  test("AC-OPS-003-01: the Owner grants 24 hours without conversations; C-Team shows the expiry and Revoke, and the audit log records it", async () => {
    const { page } = customer;
    await grantAccess(page, false);
    const card = page.getByRole("region", { name: "Hiwar support access" });
    await expect(card).toContainText(/Read-only until \d+ \w+ \d{2}:\d{2}, without conversations\./);
    await expect(card.getByRole("button", { name: "Revoke" })).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByRole("row").filter({ hasText: /support access/i }).first()).toBeVisible();
  });

  test("AC-OPS-003-02, -03: Open control panel shows the customer's panel read-only with the banner, no conversation content, and each page view is audited", async () => {
    const { page } = support;
    await page.goto("/ops/support");
    await page.getByRole("tab", { name: "Support access" }).click();
    await expect(grantRow(page, customer.org)).toContainText("Not included");
    await grantRow(page, customer.org).getByRole("button", { name: "Open control panel" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Hiwar support · read-only · until" })).toHaveText(/Hiwar support · read-only · until \d+ \w+ \d{2}:\d{2}/);
    await page.goto("/conversations");
    await expect(page.getByText("This support access does not include conversation content.")).toBeVisible();
    await page.goto("/agents");
    await expect(page.getByRole("button", { name: "New agent" })).toHaveCount(0);
    await expect(page.getByLabel("Name shown to visitors")).toBeDisabled();
    await page.goto("/team");
    await expect(page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
    await customer.page.goto("/audit");
    const viewed = customer.page.getByRole("row").filter({ hasText: "Hiwar support viewed" });
    await expect(viewed.filter({ hasText: "/agents" }).first()).toBeVisible();
    await expect(viewed.filter({ hasText: "/team" }).first()).toBeVisible();
    await expect(viewed.first().getByRole("cell").nth(2)).toHaveText("Users");
    await page.getByRole("button", { name: "Exit support access" }).click();
    await expect(page.getByText("Hiwar support · read-only")).toHaveCount(0);
  });

  test("AC-OPS-003-02: a grant that includes conversations shows their content", async () => {
    await customer.page.goto("/team");
    await customer.page.getByRole("region", { name: "Hiwar support access" }).getByRole("button", { name: "Revoke" }).click();
    await expect(customer.page.getByRole("status").filter({ hasText: "Support access revoked." })).toBeVisible();
    await grantAccess(customer.page, true);
    const { page } = support;
    await page.goto("/ops/support");
    await page.getByRole("tab", { name: "Support access" }).click();
    await grantRow(page, customer.org).getByRole("button", { name: "Open control panel" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Hiwar support · read-only · until" })).toBeVisible();
    await page.goto("/conversations");
    await expect(page.getByRole("region", { name: "Conversation" })).toContainText("Do you deliver to Sharjah?");
    await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  });

  test("AC-OPS-003-04: once the grant is revoked the operator's access ends at once", async () => {
    const { page } = support;
    await page.goto("/agents");
    await expect(page.getByText("Hiwar support · read-only")).toBeVisible();
    await customer.page.goto("/team");
    await customer.page.getByRole("region", { name: "Hiwar support access" }).getByRole("button", { name: "Revoke" }).click();
    await expect(customer.page.getByRole("status").filter({ hasText: "Support access revoked." })).toBeVisible();
    // The operator's next request no longer reaches the customer's control panel.
    for (const path of ["/agents", "/conversations"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in/);
      await expect(page.getByText("Hiwar support · read-only")).toHaveCount(0);
    }
  });

  test.fixme("AC-OPS-003-04: access ends when the grant expires (needs a server clock; the shortest grant is 1 hour)", async () => {});
});
