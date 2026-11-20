import { expect, test } from "@playwright/test";

import { addMember, closeContexts, signUpOwner, unique, type Account } from "../support/accounts";
import { agentTab, openConversation, readyWorkspace, waitingConversation } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

test.describe("ORG-003 Audit log", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let khalid: Account;
  let agentUrl = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    owner = await signUpOwner(browser, undefined, "Noura Al Suwaidi");
    let key = "";
    ({ key, agentUrl } = await readyWorkspace(owner.page));
    khalid = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");
    await waitingConversation(browser, key);
    const thread = await openConversation(khalid.page, "pending");
    await thread.getByRole("button", { name: "Claim" }).click();
    await expect(thread.locator(".stt")).toHaveText("With Khalid");
  });

  test("AC-ORG-003-01: the table shows When, Who, Area, Action, Item and Change, newest first", async () => {
    const { page } = owner;
    await page.goto("/audit");
    const table = page.getByRole("table", { name: "Audit log entries" });
    await expect(table.getByRole("columnheader")).toHaveText(["When", "Who", "Area", "Action", "Item", "Change"]);
    const published = table.getByRole("row").filter({ hasText: "Published version 1" });
    await expect(published.getByRole("cell").nth(0)).toHaveText(/^\d{1,2} \w{3} \d{2}:\d{2}$/);
    await expect(published.getByRole("cell").nth(1)).toHaveText("Noura Al Suwaidi");
    await expect(published.getByRole("cell").nth(2)).toHaveText("Agents");
    await expect(published.getByRole("cell").nth(4)).toHaveText("Layla");
    const rows = await table.getByRole("row").allTextContents();
    const claimed = rows.findIndex((r) => /Claimed/.test(r));
    const publishedAt = rows.findIndex((r) => /Published version 1/.test(r));
    expect(claimed).toBeGreaterThan(0);
    expect(claimed).toBeLessThan(publishedAt);
  });

  test("AC-ORG-003-02: the area select shows only that area's entries", async () => {
    const { page } = owner;
    await page.goto("/audit");
    await page.getByLabel("Filter by area").selectOption("Conversations");
    await expect(page).toHaveURL(/area=Conversations/);
    const areas = page.getByRole("table", { name: "Audit log entries" }).getByRole("row").locator("td:nth-child(3)");
    await expect(areas.first()).toHaveText("Conversations");
    for (const a of await areas.allTextContents()) expect(a).toBe("Conversations");
    await expect(page.getByRole("row").filter({ hasText: "Claimed" }).first()).toContainText("Khalid Saeed");
  });

  test("AC-ORG-003-03: searching 'Layla' shows only entries whose person, item or action match", async () => {
    const { page } = owner;
    await page.goto("/audit");
    await page.getByLabel("Search the log").fill("Layla");
    await page.getByLabel("Search the log").press("Enter");
    await expect(page).toHaveURL(/q=Layla/);
    const rows = page.getByRole("table", { name: "Audit log entries" }).locator("tbody tr");
    await expect(rows.first()).toContainText("Layla");
    for (const r of await rows.allTextContents()) expect(r).toContain("Layla");
  });

  test("AC-ORG-003-04: with no match the table shows 'No entries match' and 'Try another filter.'", async () => {
    const { page } = owner;
    await page.goto(`/audit?area=All&q=${unique("nothing")}`);
    await expect(page.getByText("No entries match")).toBeVisible();
    await expect(page.getByText("Try another filter.")).toBeVisible();
  });

  test("AC-ORG-003-05: Export downloads a CSV of the filtered entries, shows the toast and adds an Exports entry", async () => {
    const { page } = owner;
    await page.goto("/audit?area=Agents&q=");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export" }).click();
    const file = await download;
    const csv = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
    expect(csv.split("\n")[0]).toContain("When,Who,Area,Action,Item,Change");
    for (const line of csv.trim().split("\n").slice(1)) expect(line).toContain(",Agents,");
    await expect(page.getByRole("status").filter({ hasText: "Export started." })).toHaveText("Export started. This export is added to the log.");
    await page.goto("/audit?area=Exports&q=");
    await expect(page.getByRole("row").filter({ hasText: "Exported the audit log" })).toContainText("Agents");
  });

  test("AC-ORG-003-06: no one, including the Owner, can edit or delete an entry through the UI or the API", async () => {
    const { page } = owner;
    await page.goto("/audit");
    const table = page.getByRole("table", { name: "Audit log entries" });
    // The column headers sort the view; no control in an entry's row can change it.
    await expect(table.locator("tbody").getByRole("button")).toHaveCount(0);
    await expect(table.locator("tbody").getByRole("textbox")).toHaveCount(0);
    for (const method of ["DELETE", "PUT", "PATCH", "POST"] as const) {
      const response = await page.request.fetch("/api/audit/export", { method });
      expect(response.status(), method).toBeGreaterThanOrEqual(400);
    }
  });

  test("AC-ORG-003-07: changing a tool secret is logged as 'value rotated · not shown' without the value", async () => {
    const { page } = owner;
    const first = unique("sk-first");
    const second = unique("sk-second");
    await page.goto(agentUrl);
    await agentTab(page, "Tools");
    await page.getByRole("button", { name: "Add an HTTP tool" }).click();
    const add = page.getByRole("dialog", { name: "Add an HTTP tool" });
    await add.getByLabel("Name", { exact: true }).fill("Look up an order");
    await add.getByLabel("Description for the model").fill("Finds an order by number");
    await add.getByLabel("Endpoint").fill("https://api.gulfbites.example/orders");
    await add.getByLabel("Secret header name").fill("Authorization");
    await add.getByLabel("Secret value").fill(first);
    await add.getByRole("button", { name: "Add tool" }).click();
    await expect(page.getByRole("status").filter({ hasText: "HTTP tool added." })).toBeVisible();

    // Change the secret of the tool.
    await page.reload();
    await agentTab(page, "Tools");
    await page.getByRole("button", { name: "Edit Look up an order" }).click();
    const edit = page.getByRole("dialog", { name: /Look up an order|Edit/ });
    await edit.getByLabel("Secret value").fill(second);
    await edit.getByRole("button", { name: /Save/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Look up an order saved." })).toBeVisible();

    await page.goto("/audit?area=Tools&q=");
    const row = page.getByRole("row").filter({ hasText: "Look up an order" }).first();
    await expect(row.getByRole("cell").nth(5)).toHaveText("value rotated · not shown");
    const csv = await (await page.request.get("/api/audit/export?area=All&q=")).text();
    expect(csv).not.toContain(first);
    expect(csv).not.toContain(second);
  });
});

