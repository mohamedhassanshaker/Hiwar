import { expect, test, type Page } from "@playwright/test";

import { closeContexts, signUpOwner, type Account } from "../support/accounts";
import { addFaq, agentTab, createAgent } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function testConsole(page: Page) {
  return page.getByRole("complementary", { name: "Test console" });
}
async function ask(page: Page, text: string): Promise<void> {
  await page.getByLabel("Test message").fill(text);
  await page.getByLabel("Test message").press("Enter");
}
const COST = /\d+ input · \d+ output tokens · about AED \d+\.\d{3}/;

test.describe("AGT-003 Agent test console", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let layla = "";
  let salim = "";

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
    await addFaq(owner.page, "Do you deliver to Sharjah?", "Yes. We deliver to Sharjah until midnight on weekdays.");
    await addFaq(owner.page, "مرحبا", "أهلًا وسهلًا! كيف أقدر أساعدك اليوم؟");
    layla = await createAgent(owner.page, "Layla");
    salim = await createAgent(owner.page, "Salim");
  });

  test("AC-AGT-001-01, AC-AGT-002-01, AC-AGT-003-01: the draft answers with its source, tool calls and cost", async () => {
    const { page } = owner;
    await page.goto(layla);
    await ask(page, "Do you deliver to Sharjah?");
    const turn = testConsole(page);
    await expect(turn.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
    await expect(turn.getByText(/Do you deliver to Sharjah\? · chunk 1 · high/)).toBeVisible();
    await expect(turn.getByText("No tools used")).toBeVisible();
    await expect(turn.getByText(COST)).toBeVisible();

    await ask(page, 'Save my details [[tool:capture_lead {"name":"Omar","contact":"omar@e2e.local"}]]');
    await expect(turn.getByText(/capture_lead · read · ran/)).toBeVisible();
    await expect(turn.getByText(COST)).toHaveCount(2);
  });

  test("AC-AGT-003-02: a message with Arabic characters is answered in Arabic", async () => {
    const { page } = owner;
    await page.goto(layla);
    await ask(page, "مرحبا");
    const bubbles = testConsole(page).locator(".bubble");
    await expect(bubbles).toHaveCount(2);
    await expect(bubbles.nth(1)).toHaveText(/[؀-ۿ]/);
    await expect(bubbles.nth(1)).not.toHaveText(/[A-Za-z]{3,}/);
  });

  test("AC-AGT-003-03: Send is disabled while the input is empty; the input is 'Test message' with 'Try a visitor question'", async () => {
    const { page } = owner;
    await page.goto(layla);
    const input = page.getByLabel("Test message");
    await expect(input).toHaveAttribute("placeholder", "Try a visitor question");
    const send = testConsole(page).getByRole("button", { name: "Send" });
    await expect(send).toBeDisabled();
    await input.fill("   ");
    await expect(send).toBeDisabled();
    await input.fill("Hello");
    await expect(send).toBeEnabled();
  });

  test("AC-AGT-003-04: each suggestion chip is sent as a test message", async () => {
    const { page } = owner;
    await page.goto(layla);
    for (const [i, chip] of ["Where is my order?", "I want a refund", "مرحبا"].entries()) {
      await testConsole(page).getByRole("button", { name: chip }).click();
      await expect(testConsole(page).getByText(COST)).toHaveCount(i + 1);
      await expect(testConsole(page).locator(".bubble").nth(i * 2)).toHaveText(chip);
    }
  });

  test("AC-AGT-003-05: Reset conversation clears the test chat; selecting another agent also clears it", async () => {
    const { page } = owner;
    await page.goto(layla);
    await ask(page, "Do you deliver to Sharjah?");
    await expect(testConsole(page).getByText(COST)).toHaveCount(1);
    await testConsole(page).getByRole("button", { name: "Reset conversation" }).click();
    await expect(testConsole(page).locator(".bubble")).toHaveCount(0);

    await ask(page, "Do you deliver to Sharjah?");
    await expect(testConsole(page).getByText(COST)).toHaveCount(1);
    await page.getByRole("complementary", { name: "Agents" }).getByRole("listitem").filter({ hasText: "Salim" }).click();
    await expect(page).toHaveURL(salim);
    await expect(testConsole(page).locator(".bubble")).toHaveCount(0);
  });

  test("AC-AGT-003-06: a write tool called in the console is shown as proposed and does not run", async () => {
    const { page } = owner;
    const target = "console-transcript@e2e.local";
    await page.goto(layla);
    await agentTab(page, "Tools");
    await page.getByRole("switch", { name: "Enable Send transcript by email" }).click();
    await page.getByLabel("Confirmation for Send transcript by email").selectOption({ label: "Run automatically" });
    await ask(page, `Email me the chat [[tool:send_transcript {"email":"${target}"}]]`);
    await expect(testConsole(page).getByText(/send_transcript · write · proposed/)).toBeVisible();
    const search = await page.request.get(`${process.env.MAILPIT_URL ?? "http://localhost:8025"}/api/v1/search?query=${encodeURIComponent(`to:${target}`)}`);
    expect(((await search.json()) as { messages: unknown[] }).messages).toHaveLength(0);
  });
});
