import { expect, test, type Browser, type Page } from "@playwright/test";

import { addMember, closeContexts, mailText, signUpOwner, type Account } from "../support/accounts";
import { addCard, choosePlan, planCard } from "../support/billing";
import { operator, type Operator } from "../support/operator";
import { createAgent, openConversation, openWidget, readyWorkspace, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

const FALLBACK = "Our assistant is busy right now. A person from the team will reply here.";

function meter(page: Page, name: string) {
  return page.getByRole("progressbar", { name }).locator("xpath=..");
}

/**
 * Subscribe a new organization to Growth while the operator has lowered the Growth allowance to
 * `allowance` AI conversations, then restore the plan: the organization keeps the version it
 * subscribed to (OPS-002 FR-003), so its limit is reachable in a test.
 */
async function smallGrowth(browser: Browser, admin: Operator, allowance: number): Promise<Account & { org: string }> {
  const owner = await signUpOwner(browser);
  await addCard(owner.page);
  const plans = admin.page;
  await plans.goto("/ops/plans");
  const growth = plans.locator("section").filter({ has: plans.getByRole("heading", { name: "Growth", exact: true }) });
  const previous = await growth.getByLabel("aiConversations", { exact: true }).inputValue();
  const save = async (value: string, reason: string) => {
    await plans.goto("/ops/plans");
    await growth.getByLabel("aiConversations", { exact: true }).fill(value);
    await growth.getByPlaceholder("Reason for the change").fill(reason);
    await growth.getByRole("button", { name: "Save version" }).click();
    await expect(plans.getByRole("status").filter({ hasText: /^Growth version \d+ saved\.$/ })).toBeVisible();
  };
  await save(String(allowance), "End-to-end test of usage limits");
  try {
    await choosePlan(owner.page, "Growth");
  } finally {
    await save(previous, "Restore after the end-to-end test");
  }
  await owner.page.goto("/billing");
  await expect(meter(owner.page, "AI conversations")).toContainText(`0 of ${allowance}`);
  return owner;
}

async function aiConversation(browser: Browser, key: string, text = "Do you deliver to Sharjah?"): Promise<void> {
  const visitor = await openWidget(browser, key);
  await say(visitor, text);
  await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
  await visitor.page.context().close();
}

test.describe("BIL-001 Plan and usage", () => {
  test("AC-BIL-001-01, -14: on the trial, Usage this period shows the period, 'Trial · {n} days left' and each meter as used of limit with Choose a plan", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.goto("/billing");
    const usage = page.getByRole("region", { name: "Usage this period" });
    const now = new Date();
    const month = now.toLocaleDateString("en-GB", { month: "long" });
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString("en-GB", { month: "long" });
    await expect(usage.getByText(`1 ${month} to ${last} ${month}. Resets on 1 ${next}.`)).toBeVisible();
    await expect(usage.getByText("Trial · 14 days left")).toBeVisible();
    for (const [name, value] of [["AI conversations", "0 of 100"], ["Agents", "0 of 5"], ["Deployments", "0 of 1"], ["Seats", "1 of 10"], ["Knowledge storage", /of 5/]] as const) {
      await expect(meter(page, name)).toContainText(value);
    }
    await expect(page.getByRole("region", { name: "Choose a plan" })).toBeVisible();
  });

  test("AC-BIL-001-02: meters below 80% use the normal colour, from 80% the warning colour and at 100% the danger colour", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    for (let i = 0; i < 4; i += 1) await createAgent(page, `Agent ${i + 1}`);
    await readyWorkspace(page, "Layla");
    await page.goto("/billing");
    const bar = (name: string) => page.getByRole("progressbar", { name }).locator("span");
    await expect(page.getByRole("progressbar", { name: "Seats" })).toHaveAttribute("aria-valuenow", "10");
    await expect(bar("Seats")).toHaveCSS("background-color", "rgb(67, 56, 202)");
    await expect(page.getByRole("progressbar", { name: "Agents" })).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByRole("progressbar", { name: "Deployments" })).toHaveAttribute("aria-valuenow", "100");
    await expect(bar("Deployments")).toHaveCSS("background-color", "rgb(200, 38, 29)");
  });

  test("AC-BIL-001-02: a meter at 80% uses the warning colour", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    for (let i = 0; i < 4; i += 1) await createAgent(page, `Agent ${i + 1}`);
    await page.goto("/billing");
    await expect(page.getByRole("progressbar", { name: "Agents" })).toHaveAttribute("aria-valuenow", "80");
    await expect(page.getByRole("progressbar", { name: "Agents" }).locator("span")).toHaveCSS("background-color", "rgb(245, 165, 36)");
  });

  test("AC-BIL-001-09: Choose a plan shows monthly and yearly prices, Enterprise Custom and the VAT note", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.goto("/billing");
    const plans = page.getByRole("region", { name: "Choose a plan" });
    await expect(plans.getByText("Prices exclude 5% VAT.", { exact: false })).toBeVisible();
    await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Monthly" }).click();
    for (const [plan, price] of [["Starter", "AED 199"], ["Growth", "AED 799"], ["Business", "AED 2,999"], ["Enterprise", "Custom"]]) {
      await expect(planCard(page, plan)).toContainText(price);
    }
    await page.getByRole("group", { name: "Billing period" }).getByRole("button", { name: "Yearly" }).click();
    for (const [plan, price] of [["Starter", "AED 1,990 a year"], ["Growth", "AED 7,990 a year"], ["Business", "AED 29,990 a year"]]) {
      await expect(planCard(page, plan)).toContainText(price);
    }
  });

  test("AC-BIL-001-10: from Growth, Upgrade on Business confirms plan, price and today, then the toast shows and limits change at once", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await choosePlan(page, "Growth");
    await expect(planCard(page, "Growth").getByRole("button", { name: "Current plan" })).toBeDisabled();
    await expect(meter(page, "Agents")).toContainText("of 5");
    await planCard(page, "Business").getByRole("button", { name: "Upgrade" }).click();
    const dialog = page.getByRole("dialog", { name: "Change to Business" });
    await expect(dialog).toContainText(/Applies today: Business at AED 2,?999(\.00)? a month, excluding VAT\./);
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("status").filter({ hasText: "You are now on Business." })).toHaveText("You are now on Business. Limits and alerts update immediately.");
    await expect(meter(page, "Agents")).toContainText("of 20");
  });

  test("AC-BIL-001-11, -12: a downgrade applies next period, is blocked while over the lower plan's limits, and is scheduled once within them", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await choosePlan(page, "Growth");
    for (const name of ["Layla", "Salim", "Rana"]) await createAgent(page, name);
    await page.goto("/billing");
    await planCard(page, "Starter").getByRole("button", { name: "Switch" }).click();
    const dialog = page.getByRole("dialog", { name: "Change to Starter" });
    await expect(dialog).toContainText(/Applies from the next billing period, on 1 \w+\./);
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog.locator(".err")).toContainText(/agents/i);
    await expect(dialog.locator(".err")).toContainText(/1/);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Within the Starter limits the change is scheduled for the first day of the next period.
    const { page: small } = await signUpOwner(browser);
    await choosePlan(small, "Growth");
    await small.goto("/billing");
    await planCard(small, "Starter").getByRole("button", { name: "Switch" }).click();
    await small.getByRole("dialog", { name: "Change to Starter" }).getByRole("button", { name: "Confirm" }).click();
    await expect(small.getByRole("status").filter({ hasText: "Changes apply from the next billing period." })).toBeVisible();
    await expect(small.getByText(/^Scheduled: Starter from 1 \w+\.$/)).toBeVisible();
    await expect(planCard(small, "Growth").getByRole("button", { name: "Current plan" })).toBeVisible();
  });

  test("AC-BIL-001-13: Talk to us on Enterprise shows the toast", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.goto("/billing");
    await planCard(page, "Enterprise").getByRole("button", { name: "Talk to us" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Our team will contact you" })).toHaveText("Our team will contact you about limits, regional hosting and an SLA.");
  });

  test("AC-BIL-001-16: Update card goes to the payment provider's form and Hiwar shows only the brand and last 4 digits", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await addCard(page);
    await page.getByRole("button", { name: "Update card" }).click();
    const dialog = page.getByRole("dialog", { name: "Payment card" });
    await expect(dialog).toContainText("Card details go to the payment provider. Hiwar never stores a full card number.");
    await dialog.getByLabel(/Card number/).fill("5555555555554444");
    await dialog.getByRole("button", { name: "Save card" }).click();
    await expect(page.getByText("Mastercard ending 4444")).toBeVisible();
    await page.reload();
    expect(await page.content()).not.toContain("5555555555554444");
  });

  test.fixme("AC-BIL-001-15: PDF on an invoice downloads it with plan, any overage line, 5% VAT and the total, with the toast (needs a server clock: the first invoice is issued at the end of the first paid month)", async () => {});

  test.fixme("AC-BIL-001-17: when the grace period after a failed payment ends unpaid, new chats pause and Owner and Billing are notified (needs a server clock)", async () => {});

  test.describe("usage limits", () => {
    test.describe.configure({ mode: "serial" });
    let admin: Operator;
    let owner: Account & { org: string };
    let billing: Account;
    let support: Account;
    let key = "";

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(300_000);
      admin = await operator(browser, "platform_admin");
      owner = await smallGrowth(browser, admin, 5);
      billing = await addMember(browser, owner.page, "Billing", "Huda Billing");
      support = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");
      ({ key } = await readyWorkspace(owner.page));
    });

    test("AC-BIL-001-06: a conversation only staff replied to is not an AI conversation; one reopened within 24 hours counts once", async ({ browser }) => {
      const visitor = await openWidget(browser, key);
      await visitor.widget.getByRole("button", { name: "Talk to a person" }).click();
      await expect(visitor.widget.getByText("Waiting for our team")).toBeVisible();
      const thread = await openConversation(owner.page, "pending");
      await thread.getByRole("button", { name: "Claim" }).click();
      await owner.page.getByLabel("Message", { exact: true }).fill("Hello, how can I help?");
      await owner.page.getByRole("button", { name: "Send", exact: true }).click();
      await say(visitor, "Do you deliver to Sharjah?");
      await owner.page.goto("/billing");
      await expect(meter(owner.page, "AI conversations")).toContainText("0 of 5");

      const ai = await openWidget(browser, key);
      await say(ai, "Do you deliver to Sharjah?");
      await expect(ai.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
      const closing = await openConversation(owner.page, "ai");
      await closing.getByRole("button", { name: "Close conversation" }).click();
      await expect(closing.locator(".stt")).toHaveText("Closed");
      await say(ai, "And on Fridays?");
      await expect(ai.widget.locator(".bubble-ai")).toHaveCount(3);
      await owner.page.goto("/billing");
      await expect(meter(owner.page, "AI conversations")).toContainText("1 of 5");
    });

    test("AC-BIL-001-03, AC-PLT-008-03: at the first alert threshold the banner shows with See plans; Owner and Billing get one email and one bell notification linking to Plan and usage, other roles none", async ({ browser }) => {
      for (let i = 0; i < 3; i += 1) await aiConversation(browser, key);
      const { page } = owner;
      await page.goto("/billing");
      await expect(meter(page, "AI conversations")).toContainText("4 of 5");
      const banner = page.getByRole("status").filter({ hasText: "of this month's AI conversations" });
      await expect(banner).toContainText("You have used 80% of this month's AI conversations");
      await expect(banner.getByRole("link", { name: "See plans" })).toBeVisible();
      for (const member of [owner, billing]) {
        expect(await mailText(page, member.email, /80%|usage|AI conversations/i)).toMatch(/80%/);
        await member.page.goto("/billing");
        await member.page.getByRole("button", { name: /^Notifications/ }).click();
        const alert = member.page.getByRole("dialog", { name: "Notifications" }).getByRole("link").filter({ hasText: /80%/ });
        await expect(alert).toHaveCount(1);
        await expect(alert).toHaveAttribute("href", /\/billing/);
      }
      await support.page.goto("/conversations");
      await support.page.getByRole("button", { name: /^Notifications/ }).click();
      await expect(support.page.getByRole("dialog", { name: "Notifications" }).getByText(/80%/)).toHaveCount(0);
    });

    test("AC-BIL-001-04: alert thresholds of 70% and 95% move the banner", async () => {
      const { page } = owner;
      await page.goto("/billing");
      await page.getByLabel("First alert at").selectOption({ label: "90%" });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Limits and alerts saved." })).toBeVisible();
      await expect(page.getByText("of this month's AI conversations")).toHaveCount(0);
      await page.getByLabel("First alert at").selectOption({ label: "70%" });
      await page.getByLabel("Second alert at").selectOption({ label: "95%" });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("You have used 80% of this month's AI conversations")).toBeVisible();
      await expect(page.getByText("An alert goes to the Owner and Billing roles at 70% and 95%.", { exact: false })).toBeVisible();
    });

    test("AC-BIL-001-05: at the AI conversation limit a new visitor gets no AI reply, sees the fallback, waits for a person and staff can still reply", async ({ browser }) => {
      await aiConversation(browser, key);
      await owner.page.goto("/billing");
      await expect(meter(owner.page, "AI conversations")).toContainText("5 of 5");
      await expect(owner.page.getByLabel("Limit behavior")).toHaveValue("stop_route");
      const visitor = await openWidget(browser, key);
      await say(visitor, "Do you have vegan options?");
      await expect(visitor.widget.getByText(FALLBACK)).toBeVisible();
      await expect(visitor.widget.locator(".bubble-ai")).toHaveCount(1);
      const thread = await openConversation(owner.page, "pending", "Do you have vegan options?");
      await thread.getByRole("button", { name: "Claim" }).click();
      await owner.page.getByLabel("Message", { exact: true }).fill("Yes, we have vegan wraps.");
      await owner.page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(visitor.widget.getByText("Yes, we have vegan wraps.")).toBeVisible();
    });
  });

  test.describe("overage", () => {
    test.describe.configure({ mode: "serial" });
    let owner: Account & { org: string };
    let key = "";

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(300_000);
      const admin = await operator(browser, "platform_admin");
      owner = await smallGrowth(browser, admin, 1);
      ({ key } = await readyWorkspace(owner.page));
      const { page } = owner;
      await page.goto("/billing");
      await page.getByLabel("Limit behavior").selectOption({ label: "Continue and bill the overage up to a monthly cap" });
      await page.getByLabel("Monthly overage cap (AED)").fill("1.6");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Limits and alerts saved." })).toBeVisible();
    });

    test("AC-BIL-001-07: with overage up to a cap the AI keeps replying past the limit and the meter shows the overage in AED", async ({ browser }) => {
      for (let i = 0; i < 3; i += 1) await aiConversation(browser, key);
      await owner.page.goto("/billing");
      await expect(owner.page.getByText("2 over · AED 1.60 at AED 0.80 each")).toBeVisible();
    });

    test.fixme("AC-BIL-001-07: the next invoice has an overage line of the extra conversations × AED 0.80 (needs a server clock to end the billing period)", async () => {});

    test("AC-BIL-001-08: when the cap is reached the next extra conversation gets the default behaviour and Owner and Billing are notified", async ({ browser }) => {
      const visitor = await openWidget(browser, key);
      await say(visitor, "Do you have vegan options?");
      await expect(visitor.widget.getByText(FALLBACK)).toBeVisible();
      await expect(visitor.widget.locator(".bubble-ai")).toHaveCount(1);
      expect(await mailText(owner.page, owner.email, /cap|overage|limit/i)).toMatch(/cap/i);
      await owner.page.goto("/billing");
      await owner.page.getByRole("button", { name: /^Notifications/ }).click();
      await expect(owner.page.getByRole("dialog", { name: "Notifications" })).toContainText(/cap/i);
    });
  });
});
