import { expect, test, type Page } from "@playwright/test";

import { addMember, closeContexts, signUpOwner, type Account } from "../support/accounts";
import { namedVisitor, preChat } from "../support/inbox";
import { openConversation, readyWorkspace, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function bell(page: Page) {
  return page.getByRole("button", { name: /^Notifications, \d+ new$/ });
}
async function openBell(page: Page) {
  await page.reload();
  await bell(page).click();
  return page.getByRole("dialog", { name: "Notifications" });
}

/** A valid one-page PDF with no text layer. */
function scannedPdf(): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test.describe("PLT-008 Errors, notifications and search", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let khalid: Account;
  let builder: Account;
  let key = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    owner = await signUpOwner(browser);
    let deploymentUrl = "";
    ({ key, deploymentUrl } = await readyWorkspace(owner.page));
    await preChat(owner.page, deploymentUrl);
    khalid = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");
    builder = await addMember(browser, owner.page, "Builder", "Mariam Builder");
  });

  test("AC-PLT-008-01: a new handover raises a Support Agent's bell by 1 with '{visitor} is waiting for a person' and opens the conversation", async ({ browser }) => {
    const { page } = khalid;
    await page.goto("/conversations");
    const before = Number((await bell(page).getAttribute("aria-label"))!.match(/(\d+) new/)![1]);
    const visitor = await namedVisitor(browser, key, "Fatima Al Ketbi", "Two falafel wraps are missing from order 4821.");
    await visitor.widget.getByRole("button", { name: "Talk to a person" }).click();
    await expect(visitor.widget.getByText("Waiting for our team")).toBeVisible();
    const list = await openBell(page);
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${before + 1} new`);
    const item = list.getByRole("link").filter({ hasText: "Fatima Al Ketbi is waiting for a person" });
    await expect(item).toContainText(/visitor/i);
    await item.click();
    await expect(page).toHaveURL(/\/conversations\?c=/);
    await expect(page.getByRole("region", { name: "Conversation" })).toContainText("Fatima Al Ketbi");
  });

  test("AC-PLT-008-02: once the conversation is claimed its notification shows as done and stops counting", async () => {
    const { page } = khalid;
    const thread = await openConversation(page, "pending", "Fatima Al Ketbi");
    const before = Number((await bell(page).getAttribute("aria-label"))!.match(/(\d+) new/)![1]);
    await thread.getByRole("button", { name: "Claim" }).click();
    await expect(thread.locator(".stt")).toHaveText("With Khalid");
    const list = await openBell(page);
    await expect(bell(page)).toHaveAccessibleName(`Notifications, ${before - 1} new`);
    await expect(list.getByRole("link").filter({ hasText: "Fatima Al Ketbi is waiting for a person" })).toContainText("Done");
  });

  test("AC-PLT-008-04: a failed knowledge source shows in a Builder's bell with its name and reason, linking to Knowledge", async () => {
    const { page } = builder;
    await page.goto("/knowledge");
    await page.getByRole("button", { name: "Add a source" }).click();
    await page.getByRole("dialog", { name: "Add a source" }).locator("input[type=file]").setInputFiles({ name: "Old price list.pdf", mimeType: "application/pdf", buffer: scannedPdf() });
    await page.getByRole("button", { name: "Add and prepare" }).click();
    await expect(page.getByRole("dialog", { name: "Add a source" })).toBeHidden();
    await expect(async () => {
      const list = await openBell(page);
      await expect(list.getByRole("link").filter({ hasText: "Old price list.pdf" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 90_000 });
    const item = page.getByRole("dialog", { name: "Notifications" }).getByRole("link").filter({ hasText: "Old price list.pdf" });
    await expect(item).toContainText("The PDF is a scan with no readable text.");
    await item.click();
    await expect(page).toHaveURL(/\/knowledge/);
  });

  test("AC-PLT-008-05: Mark all as read returns the count to 0", async () => {
    const { page } = builder;
    await page.goto("/knowledge");
    await bell(page).click();
    await page.getByRole("dialog", { name: "Notifications" }).getByRole("button", { name: "Mark all as read" }).click();
    await expect(bell(page)).toHaveAccessibleName("Notifications, 0 new");
  });

  test("AC-PLT-008-06: searching 'Fatima' groups results into Conversations, Agents and Sources and opens the conversation", async () => {
    const { page } = owner;
    await page.goto("/conversations");
    await page.getByLabel("Search conversations, agents, sources").fill("Fatima");
    await page.getByLabel("Search conversations, agents, sources").press("Enter");
    await expect(page).toHaveURL(/\/search\?q=Fatima/);
    await expect(page.locator("section h2")).toHaveText(["Conversations", "Agents", "Sources"]);
    await page.locator("section").filter({ has: page.getByRole("heading", { name: "Conversations" }) }).getByRole("link", { name: /Fatima Al Ketbi/ }).click();
    await expect(page).toHaveURL(/\/conversations\?c=/);
    await expect(page.getByRole("region", { name: "Conversation" })).toContainText("Fatima Al Ketbi");
  });

  test("AC-PLT-008-07: a Builder's search shows no conversation results", async () => {
    const { page } = builder;
    await page.goto("/search?q=Fatima");
    await expect(page.getByRole("heading", { name: "Conversations" })).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("Fatima Al Ketbi");
    await expect(page.locator("section h2")).toHaveText(["Agents", "Sources"]);
  });

  test("AC-PLT-008-08, -09: offline shows the banner and keeps the unsent reply; back online the banner goes and live updates resume", async ({ browser }) => {
    const { page } = khalid;
    // The list is not filtered, so a new conversation can appear in it live.
    await page.goto("/conversations?tab=human");
    await page.getByRole("complementary", { name: "Conversation list" }).getByRole("listitem").filter({ hasText: "Fatima Al Ketbi" }).click();
    const thread = page.getByRole("region", { name: "Conversation" });
    await page.getByLabel("Message", { exact: true }).fill("Let me check that order for you.");
    await page.context().setOffline(true);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ }).filter({ hasText: "You are offline." })).toHaveText("You are offline. Changes are kept and sent when the connection is back.");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Let me check that order for you.");
    await page.context().setOffline(false);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ }).filter({ hasText: "You are offline." })).toHaveCount(0);
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Let me check that order for you.");

    const another = await namedVisitor(browser, key, "Omar Hassan", "Do you deliver to Sharjah?");
    await expect(page.getByRole("group", { name: "Filter conversations" }).getByRole("button", { name: /^All \d+$/ })).toHaveText(/^All 2$/);
    await say(another, "Thanks!");
    await expect(thread).toBeVisible();
  });

  test.fixme("AC-PLT-008-10: an expired session shows 'Your session has expired…' and returns to the same page after sign-in (needs a server clock; the shortest session is 1 day)", async () => {});
  test.fixme("AC-PLT-008-11: a server error on an action shows a toast naming what failed with 'Try again' and nothing shown as done (needs a way to make a panel action fail on the server)", async () => {});
});
