import { expect, test } from "@playwright/test";

import { inboxSeed, listItems, namedVisitor, type InboxSeed } from "../support/inbox";
import { details, openConversation, say } from "../support/workspace";
import { closeContexts } from "../support/accounts";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

test.describe("INB-001 Inbox list, thread and details", () => {
  test.describe.configure({ mode: "serial" });
  let seed: InboxSeed;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    seed = await inboxSeed(browser);
  });

  test("AC-INB-001-01: the tabs read All 3, Needs a person 1, With the AI 1, With the team 1 as plain numbers", async () => {
    const { page } = seed.owner;
    await page.goto("/conversations");
    const tabs = page.getByRole("group", { name: "Filter conversations" }).getByRole("button");
    await expect(tabs).toHaveText(["All 3", "Needs a person 1", "With the AI 1", "With the team 1"]);
    for (const count of await tabs.locator(".tnum").all()) {
      await expect(count).toHaveCSS("border-radius", "0px");
      await expect(count).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
  });

  test("AC-INB-001-02: each tab lists only its conversations; All lists open and closed ones", async () => {
    const { page } = seed.owner;
    await page.goto("/conversations");
    const tab = (name: string) => page.getByRole("group", { name: "Filter conversations" }).getByRole("button", { name: new RegExp(`^${name} \\d+$`) });
    await tab("Needs a person").click();
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page)).toContainText(["Fatima Al Ketbi"]);
    await tab("With the AI").click();
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page)).toContainText(["Omar Hassan"]);
    await tab("With the team").click();
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page)).toContainText(["Rashid Al Mazrouei"]);
    await tab("All").click();
    await expect(listItems(page)).toHaveCount(3);
  });

  test("AC-INB-001-03: the deployment select lists only that site's conversations; Today keeps today's conversations", async () => {
    const { page } = seed.owner;
    await page.goto("/conversations");
    await page.getByLabel("Deployment").selectOption({ label: "Catering page" });
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page)).toContainText(["Rashid Al Mazrouei"]);
    await page.getByLabel("Deployment").selectOption({ label: "All sites" });
    await expect(page).not.toHaveURL(/dep=/);
    await page.getByLabel("Period").selectOption({ label: "Today" });
    await expect(page).toHaveURL(/period=today/);
    await expect(listItems(page)).toHaveCount(3);
  });

  test("AC-INB-001-04: searching 'Sharjah' lists only conversations whose messages or visitor name match", async () => {
    const { page } = seed.owner;
    await page.goto("/conversations");
    await page.getByLabel("Search all messages").fill("Sharjah");
    await page.getByLabel("Search all messages").press("Enter");
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page)).toContainText(["Omar Hassan"]);
    await page.getByLabel("Search all messages").fill("Fatima");
    await page.getByLabel("Search all messages").press("Enter");
    await expect(listItems(page)).toHaveCount(1);
    await expect(listItems(page)).toContainText(["Fatima Al Ketbi"]);
  });

  test("AC-INB-001-05: a list item shows name, last message, time, a status dot with label and the site", async () => {
    const { page } = seed.owner;
    await page.goto("/conversations?tab=pending");
    const item = listItems(page).first();
    await expect(item.locator(".b")).toHaveText("Fatima Al Ketbi");
    await expect(item.locator(".sm.muted")).not.toContainText("Visitor asked for a person");
    await expect(item.locator(".sm.muted")).not.toBeEmpty();
    await expect(item.locator(".xs.muted").first()).toHaveText(/^\d{2}:\d{2}$/);
    await expect(item.locator(".stt")).toHaveText("Waiting for a person");
    await expect(item.locator(".xs.muted").last()).toHaveText("Order site");
  });

  test("AC-INB-001-06: the thread header shows visitor, site and language, the status and the version as v{n} in monospace", async () => {
    const thread = await openConversation(seed.owner.page, "ai", "Omar Hassan");
    await expect(thread.locator("span.b").filter({ hasText: /^Omar Hassan$/ })).toBeVisible();
    await expect(thread.getByText("Order site · English")).toBeVisible();
    await expect(thread.locator(".stt")).toHaveText("With the AI");
    const version = thread.getByText(/^v\d+$/);
    await expect(version).toHaveText("v1");
    await expect(version).toHaveClass(/mono/);
  });

  test("AC-INB-001-07: a waiting conversation shows 'Waiting {time}' and Claim", async () => {
    const thread = await openConversation(seed.owner.page, "pending");
    await expect(thread.getByText(/^Waiting (\d+ s|\d+ min \d+ s)$/)).toBeVisible();
    await expect(thread.getByRole("button", { name: "Claim" })).toBeVisible();
  });

  test("AC-INB-001-08: a conversation Khalid owns shows 'Khalid is replying' to Noura", async () => {
    const thread = await openConversation(seed.owner.page, "human");
    await expect(thread.getByText(/^Khalid( Saeed)? is replying$/)).toBeVisible();
  });

  test("AC-INB-001-09: no match shows the empty text and a link that clears every filter", async () => {
    const { page } = seed.owner;
    await page.goto("/conversations?tab=pending&q=nothing-matches-this");
    await expect(page.getByText("No conversations match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/conversations$/);
    await expect(page.getByLabel("Search all messages")).toHaveValue("");
    await expect(listItems(page)).toHaveCount(3);
  });

  test("AC-INB-001-10: visitor messages carry the visitor name, AI messages 'Layla (AI assistant)' with the cited source", async () => {
    const thread = await openConversation(seed.owner.page, "ai", "Omar Hassan");
    const log = thread.getByRole("log", { name: "Messages" });
    await expect(log.getByText("Omar Hassan", { exact: true }).first()).toBeVisible();
    await expect(log.getByText("Layla (AI assistant)").first()).toBeVisible();
    await expect(log.getByText("Source: Do you deliver to Sharjah?").first()).toBeVisible();
  });

  test.fixme("AC-INB-001-10: 'Layla is writing a reply…' shows while the AI generates (needs a model stand-in with a reply delay; the local stub answers at once)", async () => {});

  test("AC-INB-001-11: the handover event is shown inline in the thread", async () => {
    const thread = await openConversation(seed.owner.page, "pending");
    await expect(thread.getByRole("log", { name: "Messages" }).locator(".ev")).toContainText(["Visitor asked for a person. Reason code: visitor_request. Staff notified."]);
  });

  test("AC-INB-001-12, -15: the Visitor section shows name, language, page, deployment, started, device and country, earlier chats, and the email and phone given", async () => {
    const { page } = seed.owner;
    await openConversation(page, "pending");
    const visitor = details(page).locator(".card").filter({ has: page.getByRole("heading", { name: "Visitor" }) });
    for (const [k, v] of [
      ["Name", "Fatima Al Ketbi"],
      ["Language", "English"],
      ["Deployment", "Order site"],
      ["Email", "fatima.al.ketbi@e2e.local"],
      ["Phone", "+971 50 000 0000"],
      ["Earlier chats", "0"],
    ]) {
      await expect(visitor.locator("div.row").filter({ hasText: k }).first()).toContainText(v);
    }
    for (const k of ["Page", "Started", "Device and country"]) {
      await expect(visitor.locator("div.row").filter({ hasText: k }).first().locator("span").last()).not.toHaveText(/^(|Unknown)$/);
    }
  });

  test("AC-INB-001-13: Ownership history lists the AI taking the conversation and the handover request", async () => {
    const { page } = seed.owner;
    await openConversation(page, "pending");
    const history = details(page).locator(".card").filter({ has: page.getByRole("heading", { name: "Ownership history" }) });
    await expect(history.locator(".col.gap-0")).toHaveCount(2);
    await expect(history.locator(".col.gap-0").nth(0)).toContainText(/AI took the conversation.*\d{2}:\d{2} · first visitor message · v1/);
    await expect(history.locator(".col.gap-0").nth(1)).toContainText(/Handover requested.*\d{2}:\d{2} · visitor_request · v2/);
  });

  test("AC-INB-001-14: 'What the AI used' lists read and write tool calls for staff; the widget shows none of it", async ({ browser }) => {
    const { page } = seed.owner;
    await page.goto(seed.agentUrl);
    await page.getByRole("tablist", { name: "Agent settings" }).getByRole("tab", { name: "Tools" }).click();
    await page.getByRole("switch", { name: "Enable Send transcript by email" }).click();
    await page.getByRole("button", { name: "Publish v2" }).click();
    await expect(page.getByText("Version 2 of Layla is live.")).toBeVisible();

    const visitor = await namedVisitor(browser, seed.orderKey, "Tool Visitor", 'Note my details [[tool:capture_lead {"name":"Tool Visitor","contact":"tv@e2e.local"}]]');
    await say(visitor, 'Email me this chat [[tool:send_transcript {"email":"tv@e2e.local"}]]');
    await expect(visitor.widget.getByText("Waiting for our team")).toBeVisible();
    await openConversation(page, "pending", "Tool Visitor");
    const used = details(page).locator(".card").filter({ has: page.getByRole("heading", { name: "What the AI used" }) });
    await expect(used.getByText("capture_lead")).toBeVisible();
    await expect(used.locator(".col").filter({ hasText: "capture_lead" })).toContainText("Read tool · ran");
    await expect(used.locator(".col").filter({ hasText: "send_transcript" })).toContainText("Write tool · needs human approval · not run");
    // The visitor's own messages hold the directives; nothing staff-only is shown to them.
    for (const staffOnly of ["Read tool", "Write tool", "needs human approval", "What the AI used"]) {
      await expect(visitor.widget.locator("body")).not.toContainText(staffOnly);
    }
    for (const bubble of await visitor.widget.locator(".bubble-ai, .st").all()) await expect(bubble).not.toContainText(/capture_lead|send_transcript/);
  });

  test("AC-INB-001-16: below 768 px the list, thread and details show one at a time with back controls", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await seed.owner.page.context().storageState() });
    const page = await context.newPage();
    await page.goto("/conversations");
    const list = page.getByRole("complementary", { name: "Conversation list" });
    const thread = page.getByRole("region", { name: "Conversation" });
    const panel = page.getByRole("complementary", { name: "Conversation details" });
    await expect(list).toBeVisible();
    await expect(thread).toBeHidden();
    await list.getByRole("listitem").first().click();
    await expect(thread).toBeVisible();
    await expect(list).toBeHidden();
    await thread.getByRole("button", { name: "Details" }).click();
    await expect(panel).toBeVisible();
    await expect(thread).toBeHidden();
    await panel.getByRole("button", { name: "Back to the conversation" }).click();
    await expect(thread).toBeVisible();
    await thread.getByRole("button", { name: "Back to the list" }).click();
    await expect(list).toBeVisible();
    await expect(thread).toBeHidden();
    await context.close();
  });
});
