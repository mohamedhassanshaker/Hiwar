import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The customer journey end to end: sign-up, knowledge, agent, deployment, the widget on a
 * customer page, handover, claim, reply and hand back; then roles and billing.
 * The tests share one organization and run in order.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const owner = { name: "Noura Test", email: `owner-${run}@e2e.local`, password: "e2e-passphrase-123" };
const agentEmail = `agent-${run}@e2e.local`;
let ownerPage: Page;
let publicKey = "";

async function mailLink(page: Page, to: string, path: string): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const search = await page.request.get(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length) {
      const message = (await (await page.request.get(`http://localhost:8025/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      const match = message.Text.match(new RegExp(`http\\S+${path}\\S+`));
      if (match) return match[0];
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no email to ${to}`);
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

test("AC-ORG-004-01 to -04: Start free, verify the email, land in Conversations", async ({ browser }) => {
  ownerPage = await newPage(browser);
  const page = ownerPage;
  await page.goto("/");
  await page.getByRole("link", { name: "Start free" }).first().click();
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Work email").fill(owner.email);
  await page.getByLabel("Password").fill("short");
  await page.getByLabel("Organization name").fill("E2E Bites");
  await page.getByRole("button", { name: "Start free" }).click();
  await expect(page.getByText("Use at least 12 characters.").first()).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveValue(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Start free" }).click();
  await expect(page.getByRole("status")).toContainText("We sent a verification link");
  await page.goto(await mailLink(page, owner.email, "verify-email"));
  await expect(page).toHaveURL(/\/conversations/);
  await expect(page.getByText("Trial · 14 days left")).toBeVisible();
});

test("AC-KNO-001-04, -05: an FAQ entry is prepared to Ready", async () => {
  const page = ownerPage;
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "Add a source" }).click();
  await page.getByRole("button", { name: "FAQ entry" }).click();
  await page.getByLabel("Question").fill("Do you deliver to Sharjah?");
  await page.getByLabel("Answer").fill("Yes. We deliver to Sharjah until midnight on weekdays.");
  await page.getByRole("button", { name: "Add and prepare" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("table").getByText("Ready")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
});

test("AC-AGT-001-01, AC-AGT-002-01, AC-AGT-003-01: create, test and publish an agent", async () => {
  const page = ownerPage;
  await page.goto("/agents");
  await page.getByRole("button", { name: "New agent" }).click();
  await expect(page).toHaveURL(/\/agents\/.+/);
  await page.getByLabel("Name shown to visitors").fill("Layla");
  await page.getByLabel("Test message").fill("Do you deliver to Sharjah?");
  await page.getByLabel("Test message").press("Enter");
  const console = page.getByRole("complementary", { name: "Test console" });
  await expect(console).toContainText("We deliver to Sharjah until midnight");
  await expect(console).toContainText("chunk 1 · high");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText("Version 1 of Layla is live.")).toBeVisible();
});

test("AC-DEP-001-01, -04, -05, -06: create a deployment, verify the origin, make it live", async () => {
  const page = ownerPage;
  await page.goto("/deployments");
  await page.getByRole("button", { name: "New deployment" }).click();
  await page.getByLabel("Name").fill("Order site");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/deployments\/.+/);
  publicKey = (await page.getByLabel("Embed snippet").textContent())!.match(/pk_dep_\w+/)![0];
  await page.getByRole("button", { name: "Make live" }).click();
  await expect(page.getByText("Verify an allowed origin first.")).toBeVisible();
  await page.getByRole("tab", { name: "Allowed origins" }).click();
  await page.getByLabel("Add an origin").fill(`http://localhost:3000/demo-site/${publicKey}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Make live" }).click();
  await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
});

test("AC-DEP-003-01, AC-INB-002-05, AC-DEP-003-07, -08: widget chat, handover, claim, reply, hand back", async ({ browser }) => {
  const visitor = await newPage(browser);
  await visitor.goto(`/demo-site/${publicKey}`);
  const widget = visitor.frameLocator("iframe[title=Chat]");
  await widget.getByRole("button", { name: "Open chat" }).click();
  await widget.getByLabel("Write a message").fill("Do you deliver to Sharjah?");
  await widget.getByLabel("Write a message").press("Enter");
  await expect(widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
  await expect(widget.getByText("AI assistant · answers may be imperfect")).toBeVisible();
  await widget.getByRole("button", { name: "Talk to a person" }).click();
  // Inside operating hours the visitor waits; outside them the follow-up form shows at once (D-010).
  await expect(widget.getByText(/You asked for a person\.|No one is free right now/)).toBeVisible();

  const page = ownerPage;
  await page.goto("/conversations?tab=pending");
  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByRole("region", { name: "Conversation" }).getByText("With Noura")).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Hi, this is Noura. How can I help?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(widget.getByText("Hi, this is Noura. How can I help?")).toBeVisible();
  await expect(widget.getByText("A team member has joined")).toBeVisible();

  await page.getByRole("button", { name: "Hand back to the AI" }).click();
  await page.getByRole("button", { name: "Hand back", exact: true }).click();
  await expect(widget.getByText("The team member left. Layla will continue with you.")).toBeVisible();
  await expect(page.getByText("Handed back to the AI").first()).toBeVisible();
});

test("AC-ORG-001-02, AC-ORG-002-01: an invited Support Agent sees only Operate", async ({ browser }) => {
  const page = ownerPage;
  await page.goto("/team");
  await page.getByRole("button", { name: "Invite member" }).click();
  await page.getByLabel("Email").fill(agentEmail);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("table").getByText(agentEmail)).toBeVisible();
  const agent = await newPage(browser);
  await agent.goto(await mailLink(agent, agentEmail, "invite"));
  await agent.getByLabel("Your name").fill("Khalid Test");
  await agent.getByLabel("Password").fill("khalid-passphrase-1");
  await agent.getByRole("button", { name: "Join" }).click();
  await expect(agent).toHaveURL(/\/conversations/);
  const nav = agent.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toContainText("Conversations");
  await expect(nav).not.toContainText("Agents");
  await agent.goto("/billing");
  await expect(agent).toHaveURL(/denied=1/);
});

test("AC-BIL-001-10: add a card and upgrade from the trial", async () => {
  const page = ownerPage;
  await page.goto("/billing");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel(/Card number/).fill("4242424242424242");
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(page.getByText("Visa ending 4242")).toBeVisible();
  await page.getByRole("button", { name: "Upgrade" }).nth(1).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Growth plan").first()).toBeVisible();
});

test("AC-ORG-003-01: the audit log shows what happened", async () => {
  const page = ownerPage;
  await page.goto("/audit");
  const table = page.getByRole("table");
  await expect(table).toContainText("Published version 1");
  await expect(table).toContainText("Claimed");
  await expect(table).toContainText("Changed the plan");
});
