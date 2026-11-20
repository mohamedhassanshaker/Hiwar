import { expect, test, type Page } from "@playwright/test";

import { closeContexts, mailpit, newPage, signUpOwner, unique, type Account } from "../support/accounts";
import { agentTab, details, openConversation, openWidget, publish, readyWorkspace, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

const FALLBACK = "Our assistant is busy right now. A person from the team will reply here.";

async function behaviour(page: Page, url: string, change: (page: Page) => Promise<unknown>): Promise<void> {
  await page.goto(url);
  await page.getByRole("tab", { name: "Behavior and quotas" }).click();
  await change(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. The live widget uses the new settings." })).toBeVisible();
}

function contrast(fg: number[], bg: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
const rgb = (css: string) => css.match(/\d+/g)!.slice(0, 3).map(Number);

test.describe("DEP-002 Deployment appearance, behaviour and quotas", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let key = "";
  let deploymentUrl = "";
  let agentUrl = "";

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
    ({ key, deploymentUrl, agentUrl } = await readyWorkspace(owner.page));
  });

  test("AC-DEP-002-01: appearance changes show in the live preview at once and in the live widget after saving", async ({ browser }) => {
    const { page } = owner;
    await page.goto(deploymentUrl);
    await page.getByRole("tab", { name: "Appearance" }).click();
    const preview = page.locator(".narrow").filter({ hasText: "Live preview" });
    await page.getByLabel("Brand colour").fill("#0e7a4f");
    await expect(preview.locator(".card > div").first()).toHaveCSS("background-color", "rgb(14, 122, 79)");
    await page.getByLabel("Welcome message (English)").fill("Welcome to the E2E kitchen.");
    await expect(preview.getByText("Welcome to the E2E kitchen.")).toBeVisible();
    await page.getByLabel("Position").selectOption({ label: "Bottom left" });
    await expect(preview.getByText("Opens at the bottom left.")).toBeVisible();
    await page.getByRole("switch", { name: "Show AI label" }).click();
    await expect(preview.getByText("AI assistant")).toHaveCount(0);
    await page.getByRole("switch", { name: "Suggested questions" }).click();
    await expect(preview.locator(".sg")).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved. The live widget uses the new settings." })).toBeVisible();

    const visitorPage = await newPage(browser);
    await visitorPage.goto(`/demo-site/${key}`);
    const widget = visitorPage.frameLocator("iframe[title=Chat]");
    const launcher = widget.getByRole("button", { name: "Open chat" });
    await expect(launcher).toHaveCSS("background-color", "rgb(14, 122, 79)");
    const frame = (await visitorPage.locator("iframe[title=Chat]").boundingBox())!;
    expect(frame.x).toBeLessThan((visitorPage.viewportSize()!.width - frame.width) / 2);
    await launcher.click();
    await expect(widget.getByRole("log")).toContainText("Welcome to the E2E kitchen.");
    await expect(widget.getByText("AI assistant · answers may be imperfect")).toHaveCount(0);
    await expect(widget.locator(".sg")).toHaveCount(0);
  });

  test("AC-DEP-002-02: a brand colour with low text contrast gets a text colour that meets AA", async ({ browser }) => {
    const { page } = owner;
    await page.goto(deploymentUrl);
    await page.getByRole("tab", { name: "Appearance" }).click();
    await page.getByLabel("Brand colour").fill("#ffd400");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    const visitor = await openWidget(browser, key);
    const header = visitor.widget.locator("section.wg > div").first();
    const [bg, fg] = await header.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
    expect(rgb(bg)).toEqual([255, 212, 0]);
    expect(contrast(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(4.5);
  });

  test("AC-DEP-002-03: Pin to version keeps serving that version after a publish; Latest live follows each publish", async ({ browser }) => {
    const { page } = owner;
    const refuse = async (text: string, n: number) => {
      await page.goto(agentUrl);
      await agentTab(page, "Guardrails");
      await page.getByLabel("Blocked topics").fill("politics");
      await page.getByLabel("Refusal message").fill(text);
      await publish(page, n);
    };
    await refuse("Pinned answer from v2.", 2);
    await behaviour(page, deploymentUrl, (p) => p.getByLabel("Agent version").selectOption({ label: "Pin to version 2" }));
    await refuse("Latest answer from v3.", 3);
    let visitor = await openWidget(browser, key);
    await say(visitor, "politics please");
    await expect(visitor.widget.getByRole("log")).toContainText("Pinned answer from v2.");

    await behaviour(page, deploymentUrl, (p) => p.getByLabel("Agent version").selectOption({ label: "Latest live (v3)" }));
    visitor = await openWidget(browser, key);
    await say(visitor, "politics please");
    await expect(visitor.widget.getByRole("log")).toContainText("Latest answer from v3.");
    await refuse("Latest answer from v4.", 4);
    visitor = await openWidget(browser, key);
    await say(visitor, "politics please");
    await expect(visitor.widget.getByRole("log")).toContainText("Latest answer from v4.");
  });

  test.fixme("AC-DEP-002-04: with the language override Arabic, an English visitor message is answered in Arabic (needs a model stand-in that follows the reply-language instruction; the local model stub answers with the retrieved passage as written)", async () => {});

  test("AC-DEP-002-05: a tool excluded from the site's tool subset cannot be called there", async ({ browser }) => {
    const { page } = owner;
    const target = `${unique("subset")}@e2e.local`;
    await page.goto(agentUrl);
    await agentTab(page, "Tools");
    await page.getByRole("switch", { name: "Enable Send transcript by email" }).click();
    await page.getByLabel("Confirmation for Send transcript by email").selectOption({ label: "Run automatically" });
    await publish(page, 5);
    await behaviour(page, deploymentUrl, (p) => p.getByRole("checkbox", { name: "Send transcript by email" }).uncheck());
    const visitor = await openWidget(browser, key);
    await say(visitor, `Email me this chat [[tool:send_transcript {"email":"${target}"}]]`);
    await expect(visitor.widget.locator(".bubble-ai")).toHaveCount(2);
    await openConversation(page, "ai", "Email me this chat");
    await expect(details(page)).not.toContainText("send_transcript");
    const search = await page.request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${target}`)}`);
    expect(((await search.json()) as { messages: unknown[] }).messages).toHaveLength(0);
  });

  test("AC-DEP-002-08: with the pre-chat form on, the visitor gives name and email (phone optional) first and the inbox shows them", async ({ browser }) => {
    const { page } = owner;
    await behaviour(page, deploymentUrl, (p) => p.getByRole("switch", { name: "Pre-chat form" }).click());
    const visitor = await openWidget(browser, key);
    const w = visitor.widget;
    await expect(w.getByText("Before we start")).toBeVisible();
    await expect(w.getByLabel("Write a message")).toHaveCount(0);
    await w.getByLabel("Name").fill("Mona Prechat");
    await expect(w.getByRole("button", { name: "Start chat" })).toBeDisabled();
    await w.getByLabel("Email").fill("mona.prechat@e2e.local");
    await expect(w.getByRole("button", { name: "Start chat" })).toBeEnabled();
    await w.getByLabel("Phone (optional)").fill("+971 50 123 4567");
    await w.getByRole("button", { name: "Start chat" }).click();
    await say(visitor, "Do you deliver to Sharjah?");
    await openConversation(page, "all", "Mona Prechat");
    const panel = details(page);
    await expect(panel).toContainText("Mona Prechat");
    await expect(panel).toContainText("mona.prechat@e2e.local");
    await expect(panel).toContainText("+971 50 123 4567");
    await behaviour(page, deploymentUrl, (p) => p.getByRole("switch", { name: "Pre-chat form" }).click());
  });

  test("AC-DEP-002-07: with the concurrent limit reached, a new chat gets the behaviour at limit", async ({ browser }) => {
    const { page } = owner;
    // Close every open conversation of this organization, so only the next one counts.
    for (const id of ["ai", "pending", "human"] as const) {
      for (let i = 0; i < 30; i += 1) {
        await page.goto(`/conversations?tab=${id}`);
        const items = page.getByRole("complementary", { name: "Conversation list" }).getByRole("listitem");
        if ((await items.count()) === 0) break;
        await items.first().click();
        const thread = page.getByRole("region", { name: "Conversation" });
        await thread.getByRole("button", { name: "Close conversation" }).click();
        await expect(thread.locator(".stt")).toHaveText("Closed");
      }
    }
    await behaviour(page, deploymentUrl, (p) => p.getByLabel("Concurrent conversations").fill("1"));
    const first = await openWidget(browser, key);
    await say(first, "Do you deliver to Sharjah?");
    await expect(first.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
    const second = await openWidget(browser, key);
    await say(second, "Do you deliver to Sharjah too?");
    await expect(second.widget.getByText(FALLBACK)).toBeVisible();
    await expect(second.widget.locator(".bubble-ai")).toHaveCount(1);
    await behaviour(page, deploymentUrl, (p) => p.getByLabel("Concurrent conversations").fill("200"));
  });

  test("AC-DEP-002-06: past the monthly AI conversation quota the AI does not reply, the widget shows the fallback, the chat waits for a person and staff can reply", async ({ browser }) => {
    const { page } = owner;
    await behaviour(page, deploymentUrl, async (p) => {
      await p.getByLabel("AI conversations per month").fill("1");
      await p.getByLabel("Behavior at limit").selectOption({ label: "Stop the AI, show the fallback message and route to a person" });
    });
    const visitor = await openWidget(browser, key);
    await say(visitor, "Do you have vegan options?");
    await expect(visitor.widget.getByText(FALLBACK)).toBeVisible();
    await expect(visitor.widget.locator(".bubble-ai")).toHaveCount(1);
    const thread = await openConversation(page, "pending", "Do you have vegan options?");
    await expect(thread.locator(".stt")).toHaveText("Waiting for a person");
    await thread.getByRole("button", { name: "Claim" }).click();
    await page.getByLabel("Message", { exact: true }).fill("Yes, we have vegan wraps.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(visitor.widget.getByText("Yes, we have vegan wraps.")).toBeVisible();
    await behaviour(page, deploymentUrl, (p) => p.getByLabel("AI conversations per month").fill(""));
  });
});
