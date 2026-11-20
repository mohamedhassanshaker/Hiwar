import { expect, test, type Page } from "@playwright/test";

import { addMember, closeContexts, signUpOwner, type Account } from "../support/accounts";
import { agentTab, openConversation, openWidget, publish, readyWorkspace, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function kpi(page: Page, name: string) {
  return page.locator(".grid.g6 > .card").filter({ has: page.locator(".over", { hasText: new RegExp(`^${name}`) }) });
}

test.describe("ANA-001 Analytics dashboard", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let support: Account;
  let builder: Account;
  let key = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    owner = await signUpOwner(browser);
    let agentUrl = "";
    ({ key, agentUrl } = await readyWorkspace(owner.page));
    await owner.page.goto(agentUrl);
    await agentTab(owner.page, "Guardrails");
    await owner.page.getByLabel("Blocked topics").fill("politics");
    await publish(owner.page, 2);
    support = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");
    builder = await addMember(browser, owner.page, "Builder", "Mariam Builder");

    // 10 conversations: 6 the AI resolves and staff close with no handover, 4 that reach a person.
    for (let i = 0; i < 6; i += 1) {
      const v = await openWidget(browser, key);
      await say(v, `Do you deliver to Sharjah? (${i + 1})`);
      await expect(v.widget.locator(".bubble-ai")).toHaveCount(2);
      const thread = await openConversation(owner.page, "ai", `(${i + 1})`);
      await thread.getByRole("button", { name: "Close conversation" }).click();
      await expect(thread.locator(".stt")).toHaveText("Closed");
      await v.page.context().close();
    }
    for (let i = 0; i < 3; i += 1) {
      const v = await openWidget(browser, key);
      await say(v, `Do you deliver to Sharjah? [person ${i + 1}]`);
      await expect(v.widget.locator(".bubble-ai")).toHaveCount(2);
      await v.widget.getByRole("button", { name: "Talk to a person" }).click();
      await expect(v.widget.getByText("Waiting for our team")).toBeVisible();
      await v.page.context().close();
    }
    const sensitive = await openWidget(browser, key);
    await say(sensitive, "What about politics?");
    await expect(sensitive.widget.getByText("Waiting for our team")).toBeVisible();
    await sensitive.page.context().close();
  });

  test("AC-ANA-001-02: six KPIs: Conversations, Resolved by the AI, Reached a person, First reply, Wait for a person, Double replies", async () => {
    const { page } = owner;
    await page.goto("/analytics");
    await expect(page.locator(".grid.g6 > .card .over")).toHaveText([
      "Conversations",
      "Resolved by the AI",
      "Reached a person",
      /^First reply/,
      /^Wait for a person/,
      "Double replies",
    ]);
    await expect(kpi(page, "Conversations").locator(".num")).toHaveText("10");
    await expect(kpi(page, "Resolved by the AI").locator(".num")).toHaveText(/^\d+%$/);
    await expect(kpi(page, "Reached a person").locator(".num")).toHaveText(/^\d+%$/);
    await expect(kpi(page, "Double replies").locator(".num")).toHaveText("0");
  });

  test.fixme("AC-ANA-001-03: with 6 of 10 conversations closed without a handover, feedback No, repeat or reopening, Resolved by the AI is 60% (needs a server clock: a closed conversation counts only after 24 hours without reopening, D-014)", async () => {});

  test("AC-ANA-001-01: the Date range control sets 7, 30 or 90 days for every figure, and each KPI compares with the previous period", async () => {
    const { page } = owner;
    for (const range of [7, 30, 90]) {
      await page.goto("/analytics");
      await page.getByRole("group", { name: "Date range" }).getByRole("button", { name: `${range} days` }).click();
      await expect(page).toHaveURL(new RegExp(`range=${range}`));
      await expect(page.getByRole("group", { name: "Date range" }).getByRole("button", { name: `${range} days` })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("img", { name: "Conversations per day" }).locator(":scope > div")).toHaveCount(range);
      await expect(kpi(page, "Conversations").locator(".num")).toHaveText("10");
      const notes = page.locator(".grid.g6 > .card .xs.muted");
      await expect(notes).toHaveCount(6);
      for (const note of await notes.all()) await expect(note).toHaveText(/the period before|No earlier data/);
    }
  });

  test("AC-ANA-001-05: the Breakdown groups by Deployment, Agent or Language with conversations, resolved, reached and cost in AED", async () => {
    const { page } = owner;
    await page.goto("/analytics");
    const breakdown = page.getByRole("region", { name: "Breakdown" });
    for (const [dim, first] of [["Deployment", "Order site"], ["Agent", "Layla"], ["Language", "English"]] as const) {
      await breakdown.getByRole("group", { name: "Breakdown by" }).getByRole("button", { name: dim }).click();
      await expect(breakdown.getByRole("columnheader")).toHaveText([dim, "Conversations", "Resolved by AI", "Reached a person", "Cost per conversation"]);
      await expect(breakdown.getByRole("row").nth(1).getByRole("cell").first()).toHaveText(first);
      await expect(breakdown.getByRole("row").nth(1).getByRole("cell").nth(4)).toHaveText(/AED \d+\.\d+/);
    }
  });

  test("AC-ANA-001-06: 'Why chats reached a person' shows one bar per reason with its percentage and label", async () => {
    const { page } = owner;
    await page.goto("/analytics");
    const why = page.getByRole("region", { name: "Why chats reached a person" });
    await expect(why.locator("div.row.between").filter({ hasText: "Visitor asked for a person" })).toContainText("75%");
    await expect(why.locator("div.row.between").filter({ hasText: "Sensitive topic" })).toContainText("25%");
    await expect(why.locator(".progress")).toHaveCount(2);
    const labels = ["Visitor asked for a person", "Agent asked for a person", "Repeated low confidence", "Negative sentiment", "Sensitive topic", "Repeated tool failure", "Write tool needs approval", "Other"];
    for (const label of await why.locator("div.row.between > span:first-child").allTextContents()) expect(labels).toContain(label);
  });

  test("AC-ANA-001-07: See unanswered questions opens Knowledge on Unanswered questions", async () => {
    const { page } = owner;
    await page.goto("/analytics");
    await page.getByRole("region", { name: "Top questions" }).getByRole("link", { name: "See unanswered questions" }).click();
    await expect(page).toHaveURL(/\/knowledge\?view=unanswered/);
    await expect(page.getByRole("heading", { name: "Questions the agent could not answer well" })).toBeVisible();
  });

  test("AC-ANA-001-08: Export CSV downloads the range, shows the toast and records the export", async () => {
    const { page } = owner;
    await page.goto("/analytics?range=30");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    await expect(page.getByRole("status").filter({ hasText: "CSV export started." })).toHaveText(
      "CSV export started. Only Owner, Admin and Analyst roles can export. The export is recorded in the audit log.",
    );
    await page.goto("/audit");
    const entry = page.getByRole("row").filter({ hasText: "Exported conversations" }).first();
    await expect(entry).toContainText("Last 30 days");
    await expect(entry.getByRole("cell").nth(2)).toHaveText("Exports");
  });

  test("AC-ANA-001-09: Builders and Support Agents get no Export CSV", async () => {
    for (const member of [builder, support]) {
      await member.page.goto("/analytics");
      await expect(member.page.getByRole("heading", { name: "Analytics" })).toBeVisible();
      await expect(member.page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
    }
  });

  test("AC-ANA-001-10, AC-ORG-002-06: a Support Agent sees KPIs, conversations per day, reasons and top questions, without the cost column or Export CSV", async () => {
    const { page } = support;
    await page.goto("/analytics");
    await expect(page.locator(".grid.g6 > .card")).toHaveCount(6);
    await expect(page.getByRole("img", { name: "Conversations per day" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Why chats reached a person" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Top questions" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Breakdown" }).getByRole("columnheader", { name: "Cost per conversation" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  });

  test.fixme("AC-ANA-001-04: a conversation auto-closed and reopened by the visitor 3 hours later is not resolved by the AI (needs a server clock for the 30-minute auto-close)", async () => {});
});
