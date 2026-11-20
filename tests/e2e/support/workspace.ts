import { expect, type Browser, type FrameLocator, type Page } from "@playwright/test";

import { baseUrl, newPage } from "./accounts";

/** Add an FAQ entry in Knowledge and wait until it is Ready (KNO-001). */
export async function addFaq(page: Page, question: string, answer: string): Promise<void> {
  await page.goto("/knowledge");
  await page.getByRole("button", { name: "Add a source" }).click();
  await page.getByRole("button", { name: "FAQ entry" }).click();
  await page.getByLabel("Question").fill(question);
  await page.getByLabel("Answer").fill(answer);
  await page.getByRole("button", { name: "Add and prepare" }).click();
  const row = page.getByRole("row").filter({ hasText: question });
  await expect(async () => {
    await page.reload();
    await expect(row.getByText("Ready")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
}

/**
 * Create an agent named `name`, publish it as v1 and return its editor URL (AGT-001, AGT-002).
 * Unless `hours` is "default", its operating hours cover every day, so a request for a person
 * waits for the team whatever time the suite runs.
 */
export async function createAgent(page: Page, name: string, hours: "always" | "default" = "always"): Promise<string> {
  await page.goto("/agents");
  const before = page.url();
  await page.getByRole("button", { name: "New agent" }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(/\/agents\/.+/);
  await expect(page.getByLabel("Name shown to visitors")).toHaveValue("New agent");
  await page.getByLabel("Name shown to visitors").fill(name);
  if (hours === "always") await openAllDay(page);
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText(`Version 1 of ${name} is live.`)).toBeVisible();
  return page.url();
}

/** On the Persona tab: the first operating-hours range covers every day from 00:00 to 23:59. */
export async function openAllDay(page: Page): Promise<void> {
  for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
    await page.getByLabel(day, { exact: true }).first().check();
  }
  await page.getByLabel("From", { exact: true }).first().fill("00:00");
  await page.getByLabel("To", { exact: true }).first().fill("23:59");
}

/** Choose an editor tab of the agent (Persona, Knowledge, Tools, Guardrails, Escalation, Versions). */
export async function agentTab(page: Page, tab: string): Promise<void> {
  await page.getByRole("tablist", { name: "Agent settings" }).getByRole("tab", { name: tab }).click();
}

/** Publish the agent's draft and wait for the toast of version `n`. */
export async function publish(page: Page, n: number, name = "Layla"): Promise<void> {
  await page.getByRole("button", { name: `Publish v${n}` }).click();
  await expect(page.getByText(`Version ${n} of ${name} is live.`)).toBeVisible();
}

/** Create a deployment for `agent`, verify the local demo page as its origin and make it live; returns the public key (DEP-001). */
export async function createLiveDeployment(page: Page, name: string, agent?: string): Promise<{ key: string; url: string }> {
  const { key, url } = await createDeployment(page, name, agent);
  await page.getByRole("tab", { name: "Allowed origins" }).click();
  await page.getByLabel("Add an origin").fill(`${baseUrl}/demo-site/${key}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Make live" }).click();
  await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
  return { key, url };
}

export async function createDeployment(page: Page, name: string, agent?: string): Promise<{ key: string; url: string }> {
  await page.goto("/deployments");
  const before = page.url();
  await page.getByRole("button", { name: "New deployment" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New deployment" });
  await dialog.getByLabel("Name").fill(name);
  if (agent) await dialog.getByLabel("Agent").selectOption({ label: agent });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(/\/deployments\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  const key = (await page.getByLabel("Embed snippet").textContent())!.match(/pk_dep_\w+/)![0];
  return { key, url: page.url() };
}

/** An organization with an FAQ, a published agent and a live deployment: the state most inbox and widget scenarios start from. */
export async function readyWorkspace(page: Page, agent = "Layla"): Promise<{ key: string; deploymentUrl: string; agentUrl: string }> {
  await addFaq(page, "Do you deliver to Sharjah?", "Yes. We deliver to Sharjah until midnight on weekdays.");
  const agentUrl = await createAgent(page, agent);
  const { key, url } = await createLiveDeployment(page, "Order site", agent);
  return { key, deploymentUrl: url, agentUrl };
}

export interface Visitor {
  page: Page;
  widget: FrameLocator;
}

/** A visitor in a browser context of their own on the demo page that embeds deployment `key` (DEP-003). */
export async function openWidget(browser: Browser, key: string, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Visitor> {
  const page = await newPage(browser, options);
  await page.goto(`/demo-site/${key}`);
  const widget = page.frameLocator("iframe[title=Chat]");
  await widget.getByRole("button", { name: /Open chat|افتح المحادثة/ }).click();
  return { page, widget };
}

export async function say(visitor: Visitor, text: string): Promise<void> {
  await visitor.widget.getByLabel(/Write a message|اكتب رسالة/).fill(text);
  await visitor.widget.getByLabel(/Write a message|اكتب رسالة/).press("Enter");
  await expect(visitor.widget.getByRole("log")).toContainText(text);
}

/** The visitor asks a question the FAQ answers, then asks for a person: the conversation waits in Needs a person. */
export async function waitingConversation(browser: Browser, key: string): Promise<Visitor> {
  const visitor = await openWidget(browser, key);
  await say(visitor, "Do you deliver to Sharjah?");
  await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
  await visitor.widget.getByRole("button", { name: "Talk to a person" }).click();
  await expect(visitor.widget.getByText(/You asked for a person\.|No one is free right now/)).toBeVisible();
  return visitor;
}

/** Open a conversation of the inbox tab (the first, or the one whose item contains `text`) and return the thread region. */
export async function openConversation(page: Page, tab: "all" | "pending" | "ai" | "human" = "all", text?: string) {
  // A list item previews only the latest message, so `text` is found with the inbox's own search,
  // which matches any message and the visitor's name (INB-001 FR-004).
  const query = new URLSearchParams();
  if (tab !== "all") query.set("tab", tab);
  if (text) query.set("q", text);
  const items = page.getByRole("complementary", { name: "Conversation list" }).getByRole("listitem");
  // A conversation that has just changed state may need a moment to be listed under its tab.
  await expect(async () => {
    await page.goto(`/conversations${query.size ? `?${query}` : ""}`);
    await expect(items.first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await items.first().click();
  await expect(page).toHaveURL(/[?&]c=/);
  return page.getByRole("region", { name: "Conversation" });
}

export function details(page: Page) {
  return page.getByRole("complementary", { name: "Conversation details" });
}
