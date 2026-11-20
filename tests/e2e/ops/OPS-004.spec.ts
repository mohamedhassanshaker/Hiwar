import { expect, test, type Page } from "@playwright/test";

import { closeContexts, signUpOwner, type Account } from "../support/accounts";
import { choosePlan } from "../support/billing";
import { operator, type Operator } from "../support/operator";
import { openWidget, readyWorkspace, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function kpi(page: Page, name: string) {
  return page.locator(".grid.g4 > .card").filter({ has: page.locator(".over", { hasText: new RegExp(`^${name}$`) }) });
}

test.describe("OPS-004 AI cost, margin and service health", () => {
  test.describe.configure({ mode: "serial" });
  let admin: Operator;
  let customer: Account & { org: string };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    admin = await operator(browser, "platform_admin");
    customer = await signUpOwner(browser);
    await choosePlan(customer.page, "Starter");
    const { key } = await readyWorkspace(customer.page);
    // An expensive conversation: the model stand-in reports a large completion.
    const visitor = await openWidget(browser, key);
    await say(visitor, "Tell me everything about the menu [[tokens:2000000]]");
    await expect(visitor.widget.locator(".bubble-ai")).toHaveCount(2);
  });

  test("AC-OPS-004-01: O-Business shows revenue, AI cost, gross margin in AED and percent and AI cost per conversation, in total and per plan", async () => {
    const { page } = admin;
    await page.goto("/ops/business?range=30");
    await expect(page.getByRole("group", { name: "Range" }).getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "true");
    await expect(kpi(page, "Revenue").locator(".num")).toHaveText(/^AED [\d,.]+$/);
    await expect(kpi(page, "AI cost").locator(".num")).toHaveText(/^AED [\d,.]+$/);
    await expect(kpi(page, "Gross margin").locator(".num")).toHaveText(/^AED -?[\d,.]+$/);
    await expect(kpi(page, "Gross margin").locator(".xs")).toHaveText(/^-?\d+%$|^No revenue yet$/);
    await expect(kpi(page, "AI cost per conversation").locator(".num")).toHaveText(/^AED [\d,.]+$/);
    const perPlan = page.getByRole("table", { name: "Per plan" });
    await expect(perPlan.getByRole("columnheader")).toHaveText(["Plan", "AI conversations", "Revenue", "AI cost", "Margin"]);
    await expect(perPlan.getByRole("row").filter({ hasText: "Starter" })).toBeVisible();
  });

  test("AC-OPS-004-02: by margin, organizations with negative margin come first with plan, conversations, cost and revenue", async () => {
    const { page } = admin;
    await page.goto("/ops/business?range=30");
    const table = page.getByRole("table", { name: "Organizations by margin" });
    await expect(table.getByRole("columnheader")).toHaveText(["Organization", "Plan", "AI conversations", "AI cost", "Revenue", "Margin"]);
    const margins = (await table.locator("tbody tr td:last-child").allTextContents()).map((t) => Number(t.replace(/[^\d.-]/g, "")));
    expect(margins).toEqual([...margins].sort((a, b) => a - b));
    const row = table.getByRole("row").filter({ hasText: customer.org });
    await expect(row.getByRole("cell").nth(1)).toHaveText("Starter");
    await expect(row.getByRole("cell").nth(2)).toHaveText("1");
    await expect(row.getByRole("cell").nth(5)).toHaveClass(/c-danger/);
  });

  test("AC-OPS-004-04: the last 24 hours show first-reply median and 95th percentile, model errors, widget load errors, ingestion failures and double replies", async () => {
    const { page } = admin;
    await page.goto("/ops/business");
    const health = page.locator("section").filter({ has: page.getByRole("heading", { name: "Service health, last 24 hours" }) });
    await expect(health.getByText(/^First reply median: \d+\.\d s$/)).toBeVisible();
    await expect(health.getByText(/^95th percentile: \d+\.\d s$/)).toBeVisible();
    await expect(health.getByText(/^Model errors: \d+ of \d+$/)).toBeVisible();
    await expect(health.getByText(/^Widget load errors: \d+$/)).toBeVisible();
    await expect(health.getByText(/^Ingestion failures: \d+$/)).toBeVisible();
    await expect(health.getByText("Double replies: 0")).toBeVisible();
  });

  test("AC-OPS-004-05: a model error rate above 2% alerts Platform admins", async ({ browser }) => {
    const { key } = await (async () => {
      await customer.page.goto("/deployments");
      const link = customer.page.getByRole("link", { name: /Order site/ }).first();
      await link.click();
      const k = (await customer.page.getByLabel("Embed snippet").textContent())!.match(/pk_dep_\w+/)![0];
      return { key: k };
    })();
    for (let i = 0; i < 3; i += 1) {
      const visitor = await openWidget(browser, key);
      await say(visitor, `Hello [[fail]] ${i}`);
      await visitor.page.context().close();
    }
    const { page } = admin;
    await expect(async () => {
      await page.goto("/ops/business");
      await expect(page.getByRole("alert").filter({ hasText: /\S/ }).filter({ hasText: "Model error rate is above 2%." })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
  });

  test.fixme("AC-OPS-004-03: AI cost per conversation over AED 0.30 for 7 days in a row alerts Platform admins (needs 7 days of data or a server clock)", async () => {});
  test.fixme("AC-OPS-004-06: a recorded double reply alerts Platform admins with the organization and conversation (needs a way to produce a double reply; the single-owner check prevents one)", async () => {});
});
