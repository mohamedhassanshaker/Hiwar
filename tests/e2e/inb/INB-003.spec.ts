import { expect, test, type Page } from "@playwright/test";

import { addMember, closeContexts, mailpit, signUpOwner, unique, type Account } from "../support/accounts";
import { agentTab, details, openConversation, openWidget, publish, readyWorkspace, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

async function mailCount(page: Page, to: string): Promise<number> {
  const search = await page.request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  return ((await search.json()) as { messages: unknown[] }).messages.length;
}
function used(page: Page) {
  return details(page).locator(".card").filter({ has: page.getByRole("heading", { name: "What the AI used" }) });
}
function thread(page: Page) {
  return page.getByRole("region", { name: "Conversation" });
}

test.describe("INB-003 Write-tool approval in the inbox", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let khalid: Account;
  let huda: Account;
  let key = "";
  let agentUrl = "";
  let v = 1;

  async function policy(label: "Require staff approval" | "Ask the visitor first"): Promise<void> {
    const { page } = owner;
    await page.goto(agentUrl);
    await agentTab(page, "Tools");
    const toggle = page.getByRole("switch", { name: "Enable Send transcript by email" });
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await page.getByLabel("Confirmation for Send transcript by email").selectOption({ label });
    v += 1;
    await publish(page, v);
  }

  /** A visitor whose message makes the AI call Send transcript by email to `email`. */
  async function asksForTranscript(browser: Parameters<typeof openWidget>[0], email: string) {
    const visitor = await openWidget(browser, key);
    await say(visitor, "Do you deliver to Sharjah?");
    await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
    await say(visitor, `Email me this chat [[tool:send_transcript {"email":"${email}"}]]`);
    return visitor;
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    owner = await signUpOwner(browser);
    ({ key, agentUrl } = await readyWorkspace(owner.page));
    khalid = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");
    huda = await addMember(browser, owner.page, "Support Agent", "Huda Support");
  });

  test("AC-INB-003-01, -04, -02: a staff-approval call waits (tool_approval, not run); a non-owner cannot decide; the claimer's Approve runs it once and records it", async ({ browser }) => {
    await policy("Require staff approval");
    const email = `${unique("approve")}@e2e.local`;
    const visitor = await asksForTranscript(browser, email);
    await expect(visitor.widget.getByText("Waiting for our team")).toBeVisible();

    const { page } = khalid;
    await openConversation(page, "pending", "Email me this chat");
    // v1 when the AI took the conversation, + 1 for the approval request.
    await expect(thread(page).getByText("v2", { exact: true })).toBeVisible();
    await expect(details(page)).toContainText("tool_approval");
    const call = used(page).locator(".col").filter({ hasText: "send_transcript" });
    await expect(call).toContainText("Write tool · needs human approval · not run");
    await expect(call).toContainText(`{"email":"${email}"}`);
    expect(await mailCount(page, email)).toBe(0);

    // AC-INB-003-04: without owning the conversation there is no Approve or Reject.
    await expect(call.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(call.getByRole("button", { name: "Reject" })).toHaveCount(0);
    await expect(call.getByText("Claim the conversation to approve or reject.")).toBeVisible();

    await thread(page).getByRole("button", { name: "Claim" }).click();
    await expect(thread(page).locator(".stt")).toHaveText("With Khalid");
    await openConversation(huda.page, "human", "Email me this chat");
    await expect(used(huda.page).getByRole("button", { name: "Approve" })).toHaveCount(0);

    await used(page).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved. The tool ran once." })).toBeVisible();
    await expect(used(page).locator(".col").filter({ hasText: "send_transcript" })).toContainText("Write tool · ran");
    await expect(details(page)).toContainText("Send transcript by email approved");
    await expect(thread(page).locator(".stt")).toHaveText("With Khalid");
    await expect.poll(() => mailCount(page, email)).toBe(1);
    await owner.page.goto("/audit");
    await expect(owner.page.getByRole("table")).toContainText("Approved a write tool");
    await expect.poll(() => mailCount(page, email), { timeout: 5_000 }).toBe(1);
  });

  test("AC-INB-003-03: the owner's Reject with a reason leaves the tool unrun, shows 'rejected' with the reason, and they continue", async ({ browser }) => {
    const email = `${unique("reject")}@e2e.local`;
    const visitor = await asksForTranscript(browser, email);
    const { page } = khalid;
    await openConversation(page, "pending", "Email me this chat");
    await thread(page).getByRole("button", { name: "Claim" }).click();
    await used(page).getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog", { name: "Reject this action" });
    await expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Customer asked for WhatsApp instead");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(used(page).locator(".col").filter({ hasText: "send_transcript" })).toContainText("rejected · Customer asked for WhatsApp instead");
    await expect(thread(page).locator(".stt")).toHaveText("With Khalid");
    await page.getByLabel("Message", { exact: true }).fill("I will send it on WhatsApp.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(visitor.widget.getByText("I will send it on WhatsApp.")).toBeVisible();
    expect(await mailCount(page, email)).toBe(0);
  });

  test.fixme("AC-INB-003-05: an approved call that fails shows the failure and is not retried (needs the model stand-in to call an HTTP tool; its key is not shown in the UI)", async () => {});

  test("AC-INB-003-06: with 'Ask the visitor first' the widget shows the action with Confirm and Cancel and the tool runs only after Confirm", async ({ browser }) => {
    await policy("Ask the visitor first");
    const email = `${unique("confirm")}@e2e.local`;
    const visitor = await asksForTranscript(browser, email);
    await expect(visitor.widget.getByText("The assistant wants to: Send transcript by email. Continue?")).toBeVisible();
    expect(await mailCount(owner.page, email)).toBe(0);
    await visitor.widget.getByRole("button", { name: "Confirm" }).click();
    await expect(visitor.widget.getByRole("log")).toContainText("Done: Send transcript by email.");
    await expect.poll(() => mailCount(owner.page, email)).toBe(1);
  });

  test("AC-INB-003-07: when the visitor cancels or does not answer, the tool does not run and the AI says it was not done", async ({ browser }) => {
    const email = `${unique("cancel")}@e2e.local`;
    const visitor = await asksForTranscript(browser, email);
    await visitor.widget.getByRole("button", { name: "Cancel" }).click();
    await expect(visitor.widget.getByRole("log")).toContainText("OK, I did not do that.");
    expect(await mailCount(owner.page, email)).toBe(0);

    const silent = `${unique("silent")}@e2e.local`;
    const other = await asksForTranscript(browser, silent);
    await expect(other.widget.getByRole("button", { name: "Confirm" })).toBeVisible();
    await say(other, "Never mind, do you deliver to Sharjah?");
    await expect(other.widget.locator(".bubble-ai").last()).not.toHaveText(/^Done:/);
    expect(await mailCount(owner.page, silent)).toBe(0);
  });
});
