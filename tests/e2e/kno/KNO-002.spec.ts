import { expect, test, type Browser, type Page } from "@playwright/test";

import { closeContexts, signUpOwner, type Account } from "../support/accounts";
import { openWidget, readyWorkspace, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

async function unansweredTab(page: Page) {
  await page.goto("/knowledge?view=unanswered");
  const tab = page.getByRole("group", { name: "Knowledge views" }).getByRole("button", { name: /^Unanswered questions/ });
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
  return tab;
}
function question(page: Page, text: string) {
  return page.locator("div.row.between").filter({ has: page.locator("span.b", { hasText: text }) });
}

test.describe("KNO-002 Unanswered questions", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let key = "";

  /** One visitor per question, so each ask counts once. */
  async function ask(browser: Browser, text: string, times = 1): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      const visitor = await openWidget(browser, key);
      await say(visitor, text);
      await expect(visitor.widget.locator(".bubble-ai")).toHaveCount(2);
      await visitor.page.context().close();
    }
  }

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
    ({ key } = await readyWorkspace(owner.page));
  });

  test("AC-KNO-002-05: with nothing waiting the tab shows 'Nothing waiting'", async () => {
    const tab = await unansweredTab(owner.page);
    await expect(tab).toHaveText("Unanswered questions 0");
    await expect(owner.page.getByText("Nothing waiting")).toBeVisible();
    await expect(owner.page.getByText("New unanswered questions show up here.")).toBeVisible();
  });

  test("AC-KNO-002-01: each low-confidence question is listed with 'Asked {n} times this week · {language}'", async ({ browser }) => {
    await ask(browser, "Is there parking at the Marina branch?", 2);
    await ask(browser, "هل عندكم مواقف سيارات في فرع المارينا؟");
    await ask(browser, "Do you sell gift vouchers online?");
    const { page } = owner;
    const tab = await unansweredTab(page);
    await expect(tab).toHaveText("Unanswered questions 3");
    await expect(page.getByRole("heading", { name: "Questions the agent could not answer well" })).toBeVisible();
    await expect(question(page, "Is there parking at the Marina branch?")).toContainText("Asked 2 times this week · English");
    await expect(question(page, "هل عندكم مواقف سيارات في فرع المارينا؟")).toContainText("Asked 1 times this week · Arabic");
  });

  test("AC-KNO-002-02, -03: Write an answer opens a prefilled editor; Add as FAQ saves it, removes the question and the agent answers from it", async ({ browser }) => {
    const { page } = owner;
    await unansweredTab(page);
    const q = question(page, "Is there parking at the Marina branch?");
    await q.getByRole("button", { name: "Write an answer" }).click();
    const editor = q.getByLabel("Suggested answer");
    await expect(editor).toBeVisible();
    await expect(editor).not.toHaveValue("");
    await editor.fill("Yes. The Marina branch has free parking for 2 hours.");
    await q.getByRole("button", { name: "Add as FAQ" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added to your FAQ." })).toHaveText("Added to your FAQ. The agent can use it now.");
    await expect(question(page, "Is there parking at the Marina branch?")).toHaveCount(0);
    await page.goto("/knowledge");
    await expect(page.getByRole("row").filter({ hasText: "Is there parking at the Marina branch?" }).getByRole("cell").nth(1)).toHaveText("FAQ");

    await expect(async () => {
      const visitor = await openWidget(browser, key);
      await say(visitor, "Is there parking at the Marina branch?");
      await expect(visitor.widget.getByRole("log")).toContainText("The Marina branch has free parking for 2 hours.", { timeout: 15_000 });
      await visitor.page.context().close();
    }).toPass({ timeout: 90_000 });
  });

  test("AC-KNO-002-04: Dismiss removes the question and lowers the tab count by 1", async () => {
    const { page } = owner;
    const tab = await unansweredTab(page);
    const before = Number((await tab.locator(".tnum").textContent())!);
    await question(page, "Do you sell gift vouchers online?").getByRole("button", { name: "Dismiss" }).click();
    await expect(question(page, "Do you sell gift vouchers online?")).toHaveCount(0);
    await expect(tab.locator(".tnum")).toHaveText(String(before - 1));
  });

  test("AC-KNO-002-06: a dismissed question asked again with low confidence returns with a new count", async ({ browser }) => {
    await ask(browser, "Do you sell gift vouchers online?");
    const { page } = owner;
    await unansweredTab(page);
    // Both asks are this week: the earlier one and the one after the dismissal.
    await expect(question(page, "Do you sell gift vouchers online?")).toContainText("Asked 2 times this week · English");
  });
});
