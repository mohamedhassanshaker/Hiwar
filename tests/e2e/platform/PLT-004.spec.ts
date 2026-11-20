import { expect, test, type Locator } from "@playwright/test";

import { addMember, closeContexts, signUpOwner } from "../support/accounts";
import { openConversation, readyWorkspace, waitingConversation } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

async function dotColour(stt: Locator): Promise<string> {
  return stt.evaluate((el) => getComputedStyle(el, "::before").backgroundColor);
}

const AMBER = "rgb(138, 88, 0)"; // Warning text #8A5800 (PLT-002 FR-003)
const GREEN = "rgb(14, 122, 79)"; // Success #0E7A4F

test.describe("PLT-004 Design system components, status vocabulary and notices", () => {
  test("AC-PLT-004-01, -02: a waiting conversation has an amber dot and 'Waiting for a person'; one Khalid owns has a green dot and 'With Khalid'", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const { key } = await readyWorkspace(owner.page);
    const khalid = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");
    await waitingConversation(browser, key);

    const thread = await openConversation(owner.page, "pending");
    const listDot = owner.page.getByRole("complementary", { name: "Conversation list" }).locator(".stt").first();
    await expect(listDot).toHaveText("Waiting for a person");
    expect(await dotColour(listDot)).toBe(AMBER);
    const headDot = thread.locator(".stt");
    await expect(headDot).toHaveText("Waiting for a person");
    expect(await dotColour(headDot)).toBe(AMBER);

    const khalidThread = await openConversation(khalid.page, "pending");
    await khalidThread.getByRole("button", { name: "Claim" }).click();
    await expect(khalidThread.locator(".stt")).toHaveText("With Khalid");

    await owner.page.goto("/conversations?tab=human");
    const ownerDot = owner.page.getByRole("complementary", { name: "Conversation list" }).locator(".stt").first();
    await expect(ownerDot).toHaveText("With Khalid");
    expect(await dotColour(ownerDot)).toBe(GREEN);
    const ownerHead = owner.page.getByRole("region", { name: "Conversation" }).locator(".stt");
    await expect(ownerHead).toHaveText("With Khalid");
    expect(await dotColour(ownerHead)).toBe(GREEN);
  });

  test("AC-PLT-004-03: a toast stays 4.5 seconds, longer while hovered, and Dismiss closes it at once", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.clock.install();
    await page.goto("/conversations");
    const arabic = page.getByRole("group", { name: "Interface language" }).getByRole("button", { name: "عربي" });
    const toast = page.locator(".toast");

    await arabic.click();
    await expect(toast).toBeVisible();
    await page.clock.runFor(4_400);
    await expect(toast).toBeVisible();
    await page.clock.runFor(200);
    await expect(toast).toBeHidden();

    await arabic.click();
    await toast.hover();
    await page.clock.runFor(10_000);
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toBeHidden();
  });

  test("AC-PLT-004-04: a disabled button is at 45% opacity", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.goto("/team");
    await page.getByRole("button", { name: "Invite member" }).click();
    const send = page.getByRole("button", { name: "Send invitation" });
    await expect(send).toBeDisabled();
    await expect(send).toHaveCSS("opacity", "0.45");
  });
});
