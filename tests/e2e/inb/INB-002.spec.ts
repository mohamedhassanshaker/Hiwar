import { expect, test, type Page } from "@playwright/test";

import { addMember, closeContexts, type Account } from "../support/accounts";
import { inboxSeed, listItems, namedVisitor, type InboxSeed } from "../support/inbox";
import { details, openConversation, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function thread(page: Page) {
  return page.getByRole("region", { name: "Conversation" });
}
function version(page: Page) {
  return thread(page).getByText(/^v\d+$/);
}
async function versionOf(page: Page): Promise<number> {
  return Number((await version(page).textContent())!.slice(1));
}
function events(page: Page) {
  return thread(page).getByRole("log", { name: "Messages" }).locator(".ev");
}

test.describe("INB-002 Conversation ownership, takeover and handback", () => {
  test.describe.configure({ mode: "serial" });
  let seed: InboxSeed;
  let admin: Account;
  let huda: Account;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(360_000);
    seed = await inboxSeed(browser);
    admin = await addMember(browser, seed.owner.page, "Admin", "Aisha Admin");
    huda = await addMember(browser, seed.owner.page, "Support Agent", "Huda Support");
  });

  test("AC-INB-002-02: while the AI owns a conversation the reply field is disabled with 'Only the owner can reply' and 'Take over to reply'", async () => {
    const { page } = seed.owner;
    await openConversation(page, "ai", "Omar Hassan");
    const field = page.getByLabel("Message", { exact: true });
    await expect(field).toBeDisabled();
    await expect(field).toHaveAttribute("placeholder", "Only the owner can reply");
    await expect(thread(page).getByText("Take over to reply")).toBeVisible();
  });

  test("AC-INB-002-15: while the AI owns the conversation a visitor message gets an AI reply", async () => {
    await say(seed.c1, "Do you deliver to Sharjah on Fridays?");
    await expect(seed.c1.widget.locator(".bubble-ai")).toHaveCount(3);
  });

  test("AC-INB-002-17: a non-owner's internal note shows 'Internal note · {name}' and 'only staff see this' and never reaches the visitor", async () => {
    const { page } = seed.owner;
    await openConversation(page, "human", "Rashid Al Mazrouei");
    await thread(page).getByRole("button", { name: "Internal note" }).click();
    await expect(thread(page).getByText("Only staff see notes")).toBeVisible();
    await page.getByLabel("Message", { exact: true }).fill("Check the halal certificate before quoting.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const log = thread(page).getByRole("log", { name: "Messages" });
    await expect(log.getByText("Internal note · Noura Al Suwaidi")).toBeVisible();
    await expect(log.getByText(/· only staff see this$/)).toBeVisible();
    await expect(log.getByText("Check the halal certificate before quoting.")).toBeVisible();
    await expect(seed.c3.widget.getByRole("log")).not.toContainText("halal certificate");
  });

  test("AC-INB-002-16: while a person owns the conversation a visitor message goes only to them and the AI does not reply", async () => {
    const before = await seed.c3.widget.locator(".bubble-ai").count();
    await say(seed.c3, "Can you also do a dessert table?");
    const { page } = seed.khalid;
    await openConversation(page, "human", "Rashid Al Mazrouei");
    await expect(thread(page).getByText("Can you also do a dessert table?")).toBeVisible();
    await expect(events(page).last()).toHaveText("Delivered to Khalid Saeed only. The AI did not reply.");
    await expect(seed.c3.widget.locator(".bubble-ai")).toHaveCount(before);
  });

  test("AC-INB-002-03: the owner's reply reaches the visitor labelled with their name; Send is disabled while empty", async () => {
    const { page } = seed.khalid;
    await openConversation(page, "human", "Rashid Al Mazrouei");
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(page.getByLabel("Message", { exact: true })).toHaveAttribute("placeholder", "Write to the visitor");
    await expect(send).toBeDisabled();
    await page.getByLabel("Message", { exact: true }).fill("Yes, we can add a dessert table.");
    await send.click();
    await expect(thread(page).getByRole("log", { name: "Messages" }).locator("div.col").filter({ hasText: "Yes, we can add a dessert table." }).locator(".xs.muted").first()).toHaveText("Khalid Saeed");
    await expect(seed.c3.widget.locator(".bubble-person").filter({ hasText: "Yes, we can add a dessert table." })).toBeVisible();
    await expect(seed.c3.widget.getByText(/^Khalid( Saeed)? from support$/)).toBeVisible();
  });

  test("AC-INB-002-19: a Support Agent does not get Take over on a conversation a colleague owns", async () => {
    await openConversation(huda.page, "human", "Rashid Al Mazrouei");
    await expect(thread(huda.page).getByText(/^Khalid( Saeed)? is replying$/)).toBeVisible();
    await expect(huda.page.getByRole("button", { name: "Take over" })).toHaveCount(0);
  });

  test("AC-INB-002-10: Cancel, Close and Escape close the hand-back dialog and change nothing", async () => {
    const { page } = seed.khalid;
    await openConversation(page, "human", "Rashid Al Mazrouei");
    const v = await versionOf(page);
    const dialog = page.getByRole("dialog", { name: "Hand back to the AI" });
    for (const close of [
      () => dialog.getByRole("button", { name: "Cancel" }).click(),
      () => dialog.getByRole("button", { name: "Close" }).click(),
      () => page.keyboard.press("Escape"),
    ]) {
      await page.getByRole("button", { name: "Hand back to the AI" }).click();
      await expect(dialog).toBeVisible();
      await close();
      await expect(dialog).toBeHidden();
    }
    await page.reload();
    await expect(thread(page).locator(".stt")).toHaveText("With Khalid");
    await expect(version(page)).toHaveText(`v${v}`);
  });

  test("AC-INB-002-18: an Owner takes over from Khalid; history records supervisor_takeover and Khalid sees 'Noura took over this conversation' and loses the composer", async () => {
    const { page } = seed.owner;
    await openConversation(page, "human", "Rashid Al Mazrouei");
    const v = await versionOf(page);
    await thread(page).getByRole("button", { name: "Take over" }).click();
    await expect(thread(page).locator(".stt")).toHaveText("With Noura");
    await expect(version(page)).toHaveText(`v${v + 1}`);
    await expect(details(page)).toContainText("supervisor_takeover");
    const k = seed.khalid.page;
    await k.reload();
    await k.getByRole("button", { name: /^Notifications/ }).click();
    await expect(k.getByRole("dialog", { name: "Notifications" })).toContainText("Noura Al Suwaidi took over this conversation");
    await k.keyboard.press("Escape");
    await openConversation(k, "human", "Rashid Al Mazrouei");
    await expect(k.getByLabel("Message", { exact: true })).toBeDisabled();
    await expect(k.getByRole("button", { name: "Hand back to the AI" })).toHaveCount(0);
  });

  test("AC-INB-002-04: a reply carrying a stale version is rejected, nothing reaches the visitor and the thread refreshes", async () => {
    const stale = seed.owner.page;
    // The stale screen has not heard of the takeover: its live connection is down, as on a flaky
    // network. Nothing is faked; the server must reject the reply on its own (version check).
    await stale.route("**/api/live**", (route) => route.abort());
    await openConversation(stale, "human", "Rashid Al Mazrouei");
    const v = await versionOf(stale);
    await stale.getByLabel("Message", { exact: true }).fill("This reply was written on an old version.");

    await openConversation(admin.page, "human", "Rashid Al Mazrouei");
    await thread(admin.page).getByRole("button", { name: "Take over" }).click();
    await expect(thread(admin.page).locator(".stt")).toHaveText("With Aisha");

    await stale.getByRole("button", { name: "Send", exact: true }).click();
    // Refused by the server: the owner and version checks both reject it (INB-002 FR-004).
    await expect(stale.getByRole("status").filter({ hasText: /The conversation changed|Only the owner can reply/ })).toBeVisible();
    await expect(version(stale)).toHaveText(`v${v + 1}`);
    await expect(thread(stale).locator(".stt")).toHaveText("With Aisha");
    await expect(seed.c3.widget.getByRole("log")).not.toContainText("This reply was written on an old version.");
    await stale.unroute("**/api/live**");
  });

  test("AC-INB-002-08: hand back with a note stores it staff-only, the AI continues, the version rises and the visitor is told", async () => {
    const { page } = admin;
    await openConversation(page, "human", "Rashid Al Mazrouei");
    const v = await versionOf(page);
    await page.getByRole("button", { name: "Hand back to the AI" }).click();
    const dialog = page.getByRole("dialog", { name: "Hand back to the AI" });
    await dialog.getByLabel("Handover note").fill("Refund approved. Customer wants confirmation by email.");
    await expect(dialog.getByRole("checkbox", { name: "Tell the visitor that the assistant is back" })).toBeChecked();
    await dialog.getByRole("button", { name: "Hand back", exact: true }).click();
    await expect(thread(page).locator(".stt")).toHaveText("With the AI");
    await expect(version(page)).toHaveText(`v${v + 1}`);
    await expect(events(page).last()).toHaveText('Handed back to the AI with a staff note: "Refund approved. Customer wants confirmation by email.". The visitor does not see the note.');
    await expect(seed.c3.widget.getByText("The team member left. Layla will continue with you.")).toBeVisible();
    await expect(seed.c3.widget.getByRole("log")).not.toContainText("Refund approved");
    await say(seed.c3, "Do you deliver to Sharjah?");
    await expect(seed.c3.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
  });

  test("AC-INB-002-01: Take over on an AI conversation makes the user the owner (HUMAN_ACTIVE, version +1) and the visitor sees 'A team member has joined'", async () => {
    const { page } = seed.khalid;
    await openConversation(page, "ai", "Omar Hassan");
    const v = await versionOf(page);
    await thread(page).getByRole("button", { name: "Take over" }).click();
    await expect(thread(page).locator(".stt")).toHaveText("With Khalid");
    await expect(version(page)).toHaveText(`v${v + 1}`);
    await expect(events(page).last()).toContainText("Khalid Saeed took over.");
    await expect(seed.c1.widget.getByText("A team member has joined")).toBeVisible();
  });

  test.fixme("AC-INB-002-01: Take over while the AI is typing cancels the generation and the draft never reaches the visitor (needs a model stand-in with a reply delay; the local stub answers at once)", async () => {});

  test("AC-INB-002-09: a hand back with a blank note stores a summary written from the user's part as the staff-only note", async () => {
    const { page } = seed.khalid;
    await openConversation(page, "human", "Omar Hassan");
    await page.getByLabel("Message", { exact: true }).fill("Friday delivery to Sharjah runs until 1 am.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(seed.c1.widget.getByText("Friday delivery to Sharjah runs until 1 am.")).toBeVisible();
    await page.getByRole("button", { name: "Hand back to the AI" }).click();
    await page.getByRole("dialog", { name: "Hand back to the AI" }).getByRole("button", { name: "Hand back", exact: true }).click();
    await expect(events(page).last()).toHaveText(/^Handed back to the AI with a staff note: "Summary written by Hiwar: the person replied 1 time\. Last replies: Friday delivery to Sharjah runs until 1 am\."\. The visitor does not see the note\.$/);
    await expect(seed.c1.widget.getByRole("log")).not.toContainText("Summary written by Hiwar");
  });

  test("AC-INB-002-07: a visitor message while waiting is queued without an AI reply, and the claimer sees it", async () => {
    const before = await seed.c2.widget.locator(".bubble-ai").count();
    await say(seed.c2, "Are you still there?");
    await expect(seed.c2.widget.getByText("Waiting for our team")).toBeVisible();
    await expect(seed.c2.widget.locator(".bubble-ai")).toHaveCount(before);
    const { page } = seed.khalid;
    await openConversation(page, "pending", "Fatima Al Ketbi");
    await expect(events(page).last()).toHaveText("Queued. It goes to whoever claims this conversation.");
  });

  test("AC-INB-002-06: of two simultaneous claims exactly one succeeds; the other sees who claimed it first", async () => {
    const pages = [seed.khalid.page, huda.page];
    for (const p of pages) await openConversation(p, "pending", "Fatima Al Ketbi");
    await Promise.all(pages.map((p) => thread(p).getByRole("button", { name: "Claim" }).click()));
    const results = await Promise.all(
      pages.map(async (p) => {
        await expect(thread(p).locator(".stt")).toHaveText(/^With (Khalid|Huda)$/);
        return (await thread(p).locator(".stt").textContent())!;
      }),
    );
    expect(results[0]).toBe(results[1]);
    const winner = results[0] === "With Khalid" ? "Khalid Saeed" : "Huda Support";
    const loser = winner === "Khalid Saeed" ? huda.page : seed.khalid.page;
    await expect(loser.getByRole("status").filter({ hasText: "Only one claim succeeds." })).toHaveText(`${winner} claimed this conversation a moment earlier. Only one claim succeeds.`);
    await expect(thread(loser).getByText(new RegExp(`^${winner} is replying$`))).toBeVisible();
    const winnerPage = winner === "Khalid Saeed" ? seed.khalid.page : huda.page;
    await expect(thread(winnerPage).getByText(/^v\d+$/)).toHaveText("v3");
    await expect(seed.c2.widget.getByText("A team member has joined")).toBeVisible();
    if (winner !== "Khalid Saeed") {
      await thread(huda.page).getByRole("button", { name: "Release to queue" }).click();
      await openConversation(seed.khalid.page, "pending", "Fatima Al Ketbi");
      await thread(seed.khalid.page).getByRole("button", { name: "Claim" }).click();
      await expect(thread(seed.khalid.page).locator(".stt")).toHaveText("With Khalid");
    }
  });

  test("AC-INB-002-11: Release to queue returns the conversation to Needs a person with no owner, version +1, reason 'Released by {name}', and restarts the wait", async () => {
    const { page } = seed.khalid;
    await openConversation(page, "human", "Fatima Al Ketbi");
    const v = await versionOf(page);
    await thread(page).getByRole("button", { name: "Release to queue" }).click();
    await expect(thread(page).locator(".stt")).toHaveText("Waiting for a person");
    await expect(version(page)).toHaveText(`v${v + 1}`);
    await expect(details(page)).toContainText("Released by Khalid Saeed");
    await expect(thread(page).getByText(/^Waiting \d+ s$/)).toBeVisible();
    await expect(thread(page).getByRole("button", { name: "Claim" })).toBeVisible();
  });

  test("AC-INB-002-12: Close conversation closes it (version +1), stores a staff-only summary, asks the visitor for feedback and disables replies and notes", async () => {
    const { page } = seed.owner;
    await openConversation(page, "pending", "Fatima Al Ketbi");
    const v = await versionOf(page);
    await thread(page).getByRole("button", { name: "Close conversation" }).click();
    await expect(thread(page).locator(".stt")).toHaveText("Closed");
    await expect(version(page)).toHaveText(`v${v + 1}`);
    await expect(events(page).last()).toHaveText("Conversation closed. A summary was created and the visitor was asked for feedback.");
    await expect(seed.c2.widget.getByText("Was this helpful?")).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
    await thread(page).getByRole("button", { name: "Internal note" }).click();
    await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
  });

  test("AC-INB-002-13: a visitor message after a recent close reopens the conversation with the AI (version +1, 'Reopened by the visitor') and the AI replies", async () => {
    const { page } = seed.owner;
    await openConversation(page, "all", "Fatima Al Ketbi");
    const v = await versionOf(page);
    const before = await seed.c2.widget.locator(".bubble-ai").count();
    await say(seed.c2, "Do you deliver to Sharjah?");
    await expect(seed.c2.widget.locator(".bubble-ai")).toHaveCount(before + 1);
    await page.reload();
    await expect(thread(page).locator(".stt")).toHaveText("With the AI");
    await expect(version(page)).toHaveText(`v${v + 1}`);
    await expect(events(page)).toContainText(["Reopened by the visitor."]);
    await expect(listItems(page).filter({ hasText: "Fatima Al Ketbi" })).toHaveCount(1);
  });

  test.fixme("AC-INB-002-13: a visitor message 25 hours after the close starts a new conversation (needs a configurable reopen window or server clock)", async () => {});
  test.fixme("AC-INB-002-14: an AI conversation with no visitor message for 30 minutes is closed by the system (needs a configurable auto-close period or server clock)", async () => {});

  test("AC-INB-002-05: Claim on a waiting conversation makes the user the owner at the next version with 'first valid claim' and tells the visitor", async ({ browser }) => {
    const visitor = await namedVisitor(browser, seed.orderKey, "Layla Claim", "Do you deliver to Sharjah?");
    await visitor.widget.getByRole("button", { name: "Talk to a person" }).click();
    await expect(visitor.widget.getByText("Waiting for our team")).toBeVisible();
    const { page } = seed.khalid;
    await openConversation(page, "pending", "Layla Claim");
    await expect(version(page)).toHaveText("v2");
    await thread(page).getByRole("button", { name: "Claim" }).click();
    await expect(thread(page).locator(".stt")).toHaveText("With Khalid");
    await expect(version(page)).toHaveText("v3");
    await expect(details(page)).toContainText("first valid claim");
    await expect(visitor.widget.getByText("A team member has joined")).toBeVisible();
  });
});
