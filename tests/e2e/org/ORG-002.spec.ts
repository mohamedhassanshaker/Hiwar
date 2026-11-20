import { expect, test, type Page } from "@playwright/test";

import { addMember, closeContexts, type Account } from "../support/accounts";
import { inboxSeed, namedVisitor, type InboxSeed } from "../support/inbox";
import { agentTab, openConversation, publish, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Main navigation" });
}
/** The request is refused: the member is sent to a screen their role may open instead. */
async function refused(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const screen = path.split("?")[0];
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(screen);
}

test.describe("ORG-002 Roles and permission matrix", () => {
  test.describe.configure({ mode: "serial" });
  let seed: InboxSeed;
  let builder: Account;
  let billing: Account;
  let admin: Account;
  let analyst: Account;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    seed = await inboxSeed(browser);
    builder = await addMember(browser, seed.owner.page, "Builder", "Mariam Builder");
    billing = await addMember(browser, seed.owner.page, "Billing", "Huda Billing");
    admin = await addMember(browser, seed.owner.page, "Admin", "Aisha Admin");
    analyst = await addMember(browser, seed.owner.page, "Analyst", "Yousef Analyst");
  });

  test("AC-ORG-002-01: a Builder has no Conversations item and a direct request to view or reply is refused", async () => {
    const { page } = builder;
    await page.goto("/agents");
    await expect(nav(page)).not.toContainText("Conversations");
    await refused(page, "/conversations");
    await refused(page, "/conversations?tab=pending");
  });

  test("AC-ORG-002-02: a Support Agent can view, reply, note, claim, take over from the AI, hand back, release and approve write tools on conversations they own", async ({ browser }) => {
    const { page } = seed.khalid;
    await expect(nav(page)).toContainText("Conversations");

    // Take over from the AI, reply, write a note, hand back.
    const thread = await openConversation(page, "ai", "Omar Hassan");
    await thread.getByRole("button", { name: "Take over" }).click();
    await expect(thread.locator(".stt")).toHaveText("With Khalid");
    await page.getByLabel("Message", { exact: true }).fill("Khalid here, happy to help.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(seed.c1.widget.getByText("Khalid here, happy to help.")).toBeVisible();
    await thread.getByRole("button", { name: "Internal note" }).click();
    await page.getByLabel("Message", { exact: true }).fill("Regular customer.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(thread.getByText("Internal note · Khalid Saeed")).toBeVisible();
    await page.getByRole("button", { name: "Hand back to the AI" }).click();
    await page.getByRole("button", { name: "Hand back", exact: true }).click();
    await expect(thread.locator(".stt")).toHaveText("With the AI");

    // Claim and release.
    const waiting = await openConversation(page, "pending", "Fatima Al Ketbi");
    await waiting.getByRole("button", { name: "Claim" }).click();
    await expect(waiting.locator(".stt")).toHaveText("With Khalid");
    await waiting.getByRole("button", { name: "Release to queue" }).click();
    await expect(waiting.locator(".stt")).toHaveText("Waiting for a person");

    // Approve a write tool on a conversation they own.
    await seed.owner.page.goto(seed.agentUrl);
    await agentTab(seed.owner.page, "Tools");
    await seed.owner.page.getByRole("switch", { name: "Enable Send transcript by email" }).click();
    await publish(seed.owner.page, 2);
    const visitor = await namedVisitor(browser, seed.orderKey, "Approval Visitor", "Do you deliver to Sharjah?");
    await say(visitor, 'Email me this chat [[tool:send_transcript {"email":"approval.visitor@e2e.local"}]]');
    const approval = await openConversation(page, "pending", "Approval Visitor");
    await approval.getByRole("button", { name: "Claim" }).click();
    await page.getByRole("complementary", { name: "Conversation details" }).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved. The tool ran once." })).toBeVisible();
  });

  test("AC-ORG-002-03: Take over of a colleague's conversation is offered to Owners and Admins, not Support Agents", async ({ browser }) => {
    const huda = await addMember(browser, seed.owner.page, "Support Agent", "Huda Support");
    for (const [member, offered] of [[huda, false], [seed.owner, true], [admin, true]] as const) {
      const thread = await openConversation(member.page, "human", "Rashid Al Mazrouei");
      await expect(thread.getByRole("button", { name: "Take over" })).toHaveCount(offered ? 1 : 0);
    }
  });

  test("AC-ORG-002-04: a Billing member manages plan and invoices and has no Analytics", async () => {
    const { page } = billing;
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Plan and usage" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Choose a plan" }).getByRole("button", { name: "Current plan" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add card|Update card/ })).toBeVisible();
    await expect(page.getByRole("table", { name: "Invoices" })).toBeVisible();
    await expect(nav(page)).not.toContainText("Analytics");
    await refused(page, "/analytics");
  });

  test("AC-ORG-002-05: an Admin's request for Plan and usage is refused", async () => {
    const { page } = admin;
    await page.goto("/team");
    await expect(nav(page)).not.toContainText("Plan and usage");
    await refused(page, "/billing");
  });

  test("AC-ORG-002-07: for every role, a capability marked No has no menu item and its requests are refused", async () => {
    const matrix: [Account, string[], [string, string][]][] = [
      [builder, ["Agents", "Knowledge", "Deployments", "Analytics"], [["Conversations", "/conversations"], ["Plan and usage", "/billing"], ["Team and roles", "/team"], ["Audit log", "/audit"]]],
      [seed.khalid, ["Conversations", "Analytics"], [["Agents", "/agents"], ["Knowledge", "/knowledge"], ["Deployments", "/deployments"], ["Plan and usage", "/billing"], ["Team and roles", "/team"], ["Audit log", "/audit"]]],
      [analyst, ["Analytics"], [["Agents", "/agents"], ["Conversations", "/conversations"], ["Plan and usage", "/billing"], ["Team and roles", "/team"], ["Audit log", "/audit"]]],
      [billing, ["Plan and usage"], [["Agents", "/agents"], ["Conversations", "/conversations"], ["Analytics", "/analytics"], ["Team and roles", "/team"], ["Audit log", "/audit"]]],
      [admin, ["Agents", "Conversations", "Analytics", "Team and roles", "Audit log"], [["Plan and usage", "/billing"]]],
    ];
    for (const [member, shown, denied] of matrix) {
      await member.page.goto(`/${shown[0] === "Plan and usage" ? "billing" : shown[0].toLowerCase().split(" ")[0]}`);
      for (const item of shown) await expect(nav(member.page).getByRole("link", { name: item })).toBeVisible();
      for (const [item, path] of denied) {
        await expect(nav(member.page).getByRole("link", { name: item })).toHaveCount(0);
        await refused(member.page, path);
      }
    }
    const csv = await analyst.page.request.get("/api/audit/export");
    expect(csv.status()).toBeGreaterThanOrEqual(400);
  });
});
