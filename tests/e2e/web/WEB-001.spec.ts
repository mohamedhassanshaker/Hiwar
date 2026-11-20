import { expect, test } from "@playwright/test";

import { closeContexts, signUpOwner } from "../support/accounts";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

test.describe("WEB-001 Public home page", () => {
  test("AC-WEB-001-01: sections appear in order: hero, snippet, five steps, takeover, six features, Safe by design, footer", async ({ page }) => {
    await page.goto("/");
    const order = [
      page.getByText("Built for Arabic and English"),
      page.getByLabel("Embed snippet"),
      page.getByRole("heading", { name: "From sign-up to live chat in five steps" }),
      page.getByRole("heading", { name: "Take over any chat. Hand it back with context." }),
      page.getByRole("heading", { name: "Control without code" }),
      page.getByRole("heading", { name: "Safe by design" }),
      page.getByRole("contentinfo"),
    ];
    const tops: number[] = [];
    for (const item of order) {
      await expect(item).toBeVisible();
      tops.push((await item.boundingBox())!.y);
    }
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    await expect(page.getByRole("heading", { name: "Control without code" }).locator("xpath=..").locator(".card")).toHaveCount(6);
  });

  test("AC-WEB-001-02: the hero shows the eyebrow, headline, subhead, both actions and the Arabic tagline right to left", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Built for Arabic and English")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A capable AI assistant on your website in minutes. Your team one click away.");
    await expect(page.getByText("Hiwar answers customers in their language, around the clock.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Start free" })).toBeVisible();
    await expect(page.getByRole("link", { name: "See the control panel" })).toBeVisible();
    const tagline = page.getByText("مساعد ذكي على موقعك خلال دقائق، وفريقك جاهز للتدخل في أي لحظة.");
    await expect(tagline).toBeVisible();
    await expect(tagline).toHaveAttribute("dir", "rtl");
  });

  test("AC-WEB-001-03: Start free opens sign-up, Sign in opens sign-in, a signed-in member goes to Conversations", async ({ page, browser }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Start free" }).click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Start free" }).click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    const owner = await signUpOwner(browser);
    await owner.page.goto("/");
    await owner.page.getByRole("banner").getByRole("link", { name: "Control panel" }).click();
    await expect(owner.page).toHaveURL(/\/conversations/);
  });

  test("AC-WEB-001-04: the steps are 1 Subscribe to 5 Monitor and take over, each with its description", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "From sign-up to live chat in five steps" });
    const steps = [
      ["Subscribe", "Pick a plan and get your control panel."],
      ["Configure an agent", "Persona, instructions, knowledge, tools, guardrails and escalation rules."],
      ["Create a deployment", "Choose the sites, allowed domains, look and quotas."],
      ["Embed", "Paste one script tag. Check the install in a click."],
      ["Monitor and take over", "Watch every conversation live. Step in and hand back at any moment."],
    ];
    const items = section.locator(".stp");
    await expect(items).toHaveCount(5);
    for (const [i, [title, description]] of steps.entries()) {
      await expect(items.nth(i)).toContainText(`${i + 1}${title}${description}`);
    }
  });

  test("AC-WEB-001-05: the takeover section shows the four rules, the state strip and Try it in the inbox", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Take over any chat. Hand it back with context." });
    await expect(section.getByRole("listitem")).toHaveText([
      "The AI never replies while a person owns the chat",
      "Messages that arrive during a handover reach exactly one party",
      "Staff see the AI reply in progress, the customer never does",
      "Handback notes stay private to your team",
    ]);
    await expect(section.locator(".stt")).toHaveText(["With the AI", "Waiting for a person", "With a person", "Handed back"]);
    await expect(section.getByRole("link", { name: "Try it in the inbox" })).toBeVisible();
  });

  test("AC-WEB-001-06: Safe by design lists the seven guarantees with See plans", async ({ page }) => {
    await page.goto("/");
    const band = page.getByRole("heading", { name: "Safe by design" }).locator("xpath=../..");
    await expect(band.getByRole("listitem")).toHaveText([
      "Each organization is isolated",
      "Guardrails on topics and replies",
      "Write tools ask first",
      "Secrets never reach the model",
      "Customer data is not used to train models",
      "An audit log of every change",
      "One owner per conversation",
    ]);
    await band.getByRole("link", { name: "See plans" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test("AC-WEB-001-07: signing out from the panel returns to Home", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A capable AI assistant on your website in minutes. Your team one click away.");
  });

  test("AC-WEB-001-08: at 390 px every section is readable without horizontal scrolling", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
