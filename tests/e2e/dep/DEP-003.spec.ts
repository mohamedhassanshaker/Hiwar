import { expect, test } from "@playwright/test";

import { addMember, closeContexts, signUpOwner, type Account } from "../support/accounts";
import { agentTab, openConversation, openWidget, publish, readyWorkspace, say, waitingConversation } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

test.describe("DEP-003 Visitor chat widget", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let khalid: Account;
  let key = "";
  let agentUrl = "";
  let deploymentUrl = "";

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
    ({ key, agentUrl, deploymentUrl } = await readyWorkspace(owner.page));
    khalid = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");
  });

  test("AC-DEP-003-01: the panel shows the agent header, welcome, suggestions, input, Talk to a person and the AI notice", async ({ browser }) => {
    const { widget } = await openWidget(browser, key);
    const panel = widget.getByRole("region", { name: "Layla" });
    await expect(panel.getByText("Layla", { exact: true })).toBeVisible();
    await expect(panel.getByText("AI assistant", { exact: true })).toBeVisible();
    await expect(widget.getByRole("log").locator(".bubble-ai").first()).not.toBeEmpty();
    await expect(widget.locator(".sg").first()).toBeVisible();
    await expect(widget.getByLabel("Write a message")).toHaveAttribute("placeholder", "Write a message");
    await expect(widget.getByRole("button", { name: "Talk to a person" })).toBeVisible();
    await expect(widget.getByText("AI assistant · answers may be imperfect")).toBeVisible();
  });

  test("AC-DEP-003-02, -03: Enter or Send sends and the reply follows; Send is disabled while empty; suggestions hide after the first message", async ({ browser }) => {
    const visitor = await openWidget(browser, key);
    const { widget } = visitor;
    const send = widget.getByRole("button", { name: "Send" });
    await expect(send).toBeDisabled();
    await widget.getByLabel("Write a message").fill("Do you deliver to Sharjah?");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
    await expect(widget.getByText("Layla is typing…")).toBeHidden();
    await expect(widget.locator(".sg")).toHaveCount(0);
    await widget.getByLabel("Write a message").fill("Thanks");
    await widget.getByLabel("Write a message").press("Enter");
    await expect(widget.locator(".bubble-me")).toHaveCount(2);
  });

  test.fixme("AC-DEP-003-02: 'Layla is typing…' shows until the reply (needs a model stand-in with a reply delay; the local stub answers before the typing state reaches the widget)", async () => {});

  test("AC-DEP-003-04: Close chat returns to the bubble and keeps the conversation", async ({ browser }) => {
    const visitor = await openWidget(browser, key);
    await say(visitor, "Do you deliver to Sharjah?");
    await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
    await visitor.widget.getByRole("button", { name: "Close chat" }).click();
    await expect(visitor.widget.getByRole("button", { name: "Open chat" })).toBeVisible();
    await visitor.widget.getByRole("button", { name: "Open chat" }).click();
    await expect(visitor.widget.getByRole("log")).toContainText("Do you deliver to Sharjah?");
    await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
  });

  test("AC-DEP-003-05, -06: waiting shows the waiting header, lines and Cancel; Cancel lets the AI continue", async ({ browser }) => {
    const visitor = await waitingConversation(browser, key);
    const { widget } = visitor;
    await expect(widget.getByText("Waiting for our team")).toBeVisible();
    await expect(widget.getByText("Usually under 2 minutes")).toBeVisible();
    await expect(widget.getByText("You asked for a person. We are finding someone from the team.")).toBeVisible();
    await expect(widget.getByText(/A person will join shortly/)).toBeVisible();
    await widget.getByRole("button", { name: "Cancel" }).click();
    await expect(widget.getByText("You cancelled the request. The assistant continues.")).toBeVisible();
    await expect(widget.getByText("Waiting for our team")).toBeHidden();
    await say(visitor, "Do you deliver to Sharjah?");
    await expect(widget.locator(".bubble-ai")).toHaveCount(3);
  });

  test("AC-DEP-003-01, AC-INB-002-05, AC-DEP-003-07, -08: claim shows the person in the widget; hand back brings Layla back with or without a note", async ({ browser }) => {
    const visitor = await waitingConversation(browser, key);
    const { widget } = visitor;
    const thread = await openConversation(khalid.page, "pending");
    await expect(thread.getByText(/^v\d+$/)).toHaveText("v2");
    await thread.getByRole("button", { name: "Claim" }).click();
    await expect(thread.locator(".stt")).toHaveText("With Khalid");
    await expect(thread.getByText("v3", { exact: true })).toBeVisible();
    await expect(khalid.page.getByRole("complementary", { name: "Conversation details" })).toContainText(/first valid claim/);
    await expect(widget.getByText("A team member has joined")).toBeVisible();
    await expect(widget.getByText(/^Khalid( Saeed)? from support$/)).toBeVisible();
    await expect(widget.getByText("A real person · online")).toBeVisible();
    await expect(widget.locator("section.wg .avatar").first()).toHaveText("K");
    await expect(widget.getByText("AI assistant · answers may be imperfect")).toHaveCount(0);

    await khalid.page.getByLabel("Message", { exact: true }).fill("Hi, this is Khalid. How can I help?");
    await khalid.page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(widget.getByText("Hi, this is Khalid. How can I help?")).toBeVisible();

    await khalid.page.getByRole("button", { name: "Hand back to the AI" }).click();
    await khalid.page.getByRole("button", { name: "Hand back", exact: true }).click();
    await expect(widget.getByText("The team member left. Layla will continue with you.")).toBeVisible();
    await expect(widget.getByText("AI assistant · answers may be imperfect")).toBeVisible();

    const quiet = await waitingConversation(browser, key);
    const second = await openConversation(khalid.page, "pending");
    await second.getByRole("button", { name: "Claim" }).click();
    await expect(quiet.widget.getByText("A team member has joined")).toBeVisible();
    await khalid.page.getByRole("button", { name: "Hand back to the AI" }).click();
    await khalid.page.getByRole("dialog", { name: "Hand back to the AI" }).getByRole("checkbox").uncheck();
    await khalid.page.getByRole("button", { name: "Hand back", exact: true }).click();
    await expect(quiet.widget.getByText("AI assistant · answers may be imperfect")).toBeVisible();
    await expect(quiet.widget.getByText("The team member left. Layla will continue with you.")).toHaveCount(0);
  });

  test("AC-DEP-003-10: a paused deployment shows the offline message and a form for an email and a message", async ({ browser }) => {
    const { page } = owner;
    await page.goto(deploymentUrl);
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Make live" })).toBeVisible();
    const { widget } = await openWidget(browser, key);
    await expect(widget.getByText("We are offline right now", { exact: true })).toBeVisible();
    await expect(widget.getByText("Leave your email and we will reply tomorrow morning.")).toBeVisible();
    await widget.getByLabel("Email").fill("later@e2e.local");
    await widget.getByLabel("Message").fill("Please call me back about catering.");
    await widget.getByRole("button", { name: "Send" }).click();
    await expect(widget.getByText("Thanks. We will get back to you.")).toBeVisible();
    await page.getByRole("button", { name: "Make live" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  test("AC-DEP-003-11: in Arabic the widget is mirrored, right aligned, dir=rtl and uses Arabic copy", async ({ browser }) => {
    const { widget } = await openWidget(browser, key);
    await widget.getByRole("button", { name: "عربي" }).click();
    const root = widget.locator(".wg-root");
    await expect(root).toHaveAttribute("dir", "rtl");
    await expect(root).toHaveAttribute("lang", "ar");
    await expect(widget.getByRole("button", { name: "تحدث مع شخص" })).toBeVisible();
    await expect(widget.getByText("مساعد ذكي · قد تكون الإجابات غير دقيقة")).toBeVisible();
    await expect(widget.getByLabel("اكتب رسالة")).toHaveAttribute("placeholder", "اكتب رسالة");
    await expect(widget.locator(".sg").first()).toHaveText(/[؀-ۿ]/);
    await expect(widget.locator(".bubble-ai").first()).toHaveText(/[؀-ۿ]/);
    await expect(widget.locator(".bubble-ai").first()).toHaveCSS("direction", "rtl");
  });

  test("AC-DEP-003-12: a write tool with 'Ask the visitor first' shows what will be done with Confirm and Cancel", async ({ browser }) => {
    const { page } = owner;
    await page.goto(agentUrl);
    await agentTab(page, "Tools");
    await page.getByRole("switch", { name: "Enable Send transcript by email" }).click();
    await page.getByLabel("Confirmation for Send transcript by email").selectOption({ label: "Ask the visitor first" });
    await publish(page, 2);
    const visitor = await openWidget(browser, key);
    await say(visitor, 'Email me this chat [[tool:send_transcript {"email":"widget-confirm@e2e.local"}]]');
    await expect(visitor.widget.getByText("The assistant wants to: Send transcript by email. Continue?")).toBeVisible();
    await expect(visitor.widget.getByRole("button", { name: "Confirm" })).toBeVisible();
    await expect(visitor.widget.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("AC-DEP-003-13: when staff close the conversation the widget asks 'Was this helpful?' and stores the answer", async ({ browser }) => {
    const visitor = await openWidget(browser, key);
    await say(visitor, "Do you deliver to Sharjah?");
    await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
    const thread = await openConversation(owner.page, "ai", "Do you deliver to Sharjah?");
    await thread.getByRole("button", { name: "Close conversation" }).click();
    await expect(thread.locator(".stt")).toHaveText("Closed");
    await expect(visitor.widget.getByText("Was this helpful?")).toBeVisible();
    await visitor.widget.getByRole("button", { name: "Yes" }).click();
    await expect(visitor.widget.getByText("Thanks for your feedback.")).toBeVisible();
    await visitor.page.reload();
    await visitor.widget.getByRole("button", { name: "Open chat" }).click();
    await expect(visitor.widget.getByText("Was this helpful?")).toHaveCount(0);
  });

  test("AC-DEP-003-14: offline, a sent message shows 'Connection lost…' and is sent after reconnecting", async ({ browser }) => {
    const visitor = await openWidget(browser, key);
    await say(visitor, "Hello");
    await visitor.page.context().setOffline(true);
    await visitor.widget.getByLabel("Write a message").fill("Do you deliver to Sharjah?");
    await visitor.widget.getByLabel("Write a message").press("Enter");
    await expect(visitor.widget.getByText("Connection lost. We will send your message when you are back online.")).toBeVisible();
    await visitor.page.context().setOffline(false);
    await expect(visitor.widget.locator(".bubble-me").filter({ hasText: "Do you deliver to Sharjah?" })).toBeVisible();
    await expect(visitor.widget.getByText("Connection lost.", { exact: false })).toBeHidden();
    await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
  });

  test("AC-DEP-003-09: when no one claims within the claim wait the widget asks for contact details and promises follow-up", async ({ browser }) => {
    test.setTimeout(240_000);
    const { page } = owner;
    await page.goto(agentUrl);
    await agentTab(page, "Escalation");
    await page.getByLabel("Claim wait (minutes)").fill("1");
    await page.getByLabel(/When no one claims it within/).selectOption({ label: "Collect contact details and promise follow-up" });
    await publish(page, 3);
    const visitor = await waitingConversation(browser, key);
    await expect(visitor.widget.getByText("No one is free right now")).toBeVisible({ timeout: 150_000 });
    await expect(visitor.widget.getByText("Leave your contact details and we will follow up.")).toBeVisible();
  });
});
