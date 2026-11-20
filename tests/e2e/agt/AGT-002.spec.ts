import { expect, test, type Page } from "@playwright/test";

import { closeContexts, signUpOwner, type Account } from "../support/accounts";
import { choosePlan } from "../support/billing";
import { addFaq, agentTab, createAgent, createLiveDeployment, openWidget, publish, say } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

/** v1 refuses "politics" with R1; later versions are given other refusal messages, so a reply shows which version answered. */
async function setRefusal(page: Page, text: string): Promise<void> {
  await agentTab(page, "Guardrails");
  await page.getByLabel("Blocked topics").fill("politics");
  await page.getByLabel("Refusal message").fill(text);
}

async function deploymentSettings(page: Page, url: string, version: string): Promise<void> {
  await page.goto(url);
  await page.getByRole("tab", { name: "Behavior and quotas" }).click();
  await page.getByLabel("Agent version").selectOption({ label: version });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. The live widget uses the new settings." })).toBeVisible();
}

test.describe("AGT-002 Agent versions, publish and roll back", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let agentUrl = "";
  let latest: { key: string; url: string };
  let pinned: { key: string; url: string };

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
    // Two deployments need Growth; the trial allows one.
    await choosePlan(owner.page, "Growth");
    await addFaq(owner.page, "Do you deliver to Sharjah?", "Yes. We deliver to Sharjah until midnight on weekdays.");
  });

  test("AC-AGT-002-04: an agent never published lists only the Draft and offers Publish v1", async () => {
    const { page } = owner;
    await page.goto("/agents");
    await page.getByRole("button", { name: "New agent" }).click();
    await expect(page).toHaveURL(/\/agents\/.+/);
    await agentTab(page, "Versions");
    const editor = page.getByRole("region", { name: "Agent editor" });
    await expect(editor.getByText(/^Version \d+$/)).toHaveText(["Version 1"]);
    await expect(editor.getByText("Your unpublished changes")).toBeVisible();
    await expect(editor.locator(".stt", { hasText: "Draft" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Roll back to this" })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Publish v1" })).toBeVisible();
  });

  test("AC-AGT-002-01: publishing the draft makes v2 live, shows the toast and 'Up to date', and the audit log records it", async () => {
    const { page } = owner;
    agentUrl = await createAgent(page, "Layla");
    await page.goto(agentUrl);
    await setRefusal(page, "R1: I only talk about food.");
    await expect(page.getByText("Unpublished changes")).toBeVisible();
    await page.getByRole("button", { name: "Publish v2" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Version 2 of Layla is live." })).toHaveText(
      /Version 2 of Layla is live\. Deployments that follow the latest version now use it\./,
    );
    await expect(page.getByText("Up to date")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish v3" })).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByRole("table")).toContainText("Published version 2");
  });

  test("AC-AGT-002-02: a deployment that follows the latest version uses a new version; a pinned one keeps its version", async ({ browser }) => {
    const { page } = owner;
    latest = await createLiveDeployment(page, "Order site", "Layla");
    pinned = await createLiveDeployment(page, "Catering page", "Layla");
    await deploymentSettings(page, pinned.url, "Pin to version 2");
    await page.goto(agentUrl);
    await setRefusal(page, "R3: version three refuses.");
    await publish(page, 3);

    const onLatest = await openWidget(browser, latest.key);
    await say(onLatest, "Tell me about politics");
    await expect(onLatest.widget.getByRole("log")).toContainText("R3: version three refuses.");
    const onPinned = await openWidget(browser, pinned.key);
    await say(onPinned, "Tell me about politics");
    await expect(onPinned.widget.getByRole("log")).toContainText("R1: I only talk about food.");
    await expect(onPinned.widget.getByRole("log")).not.toContainText("R3");
  });

  test("AC-AGT-002-03: a conversation in progress keeps the version it started with", async ({ browser }) => {
    const { page } = owner;
    const visitor = await openWidget(browser, latest.key);
    await say(visitor, "Do you deliver to Sharjah?");
    await expect(visitor.widget.getByRole("log")).toContainText("We deliver to Sharjah until midnight");
    await page.goto(agentUrl);
    await setRefusal(page, "R4: version four refuses.");
    await publish(page, 4);
    await say(visitor, "And politics?");
    await expect(visitor.widget.getByRole("log")).toContainText("R3: version three refuses.");
    await expect(visitor.widget.getByRole("log")).not.toContainText("R4");
  });

  test("AC-AGT-002-05, -07: Roll back to this names the version and the deployments that follow the latest; Cancel keeps the live version", async () => {
    const { page } = owner;
    await page.goto(agentUrl);
    await agentTab(page, "Versions");
    const editor = page.getByRole("region", { name: "Agent editor" });
    const v4 = editor.locator("div.row.between").filter({ hasText: "Version 4" }).filter({ hasText: /Published/ });
    await expect(v4.getByText("Live")).toBeVisible();
    await expect(v4).toContainText(/Published \d+ \w+ by Noura Test/);
    const v2 = editor.locator("div.row.between").filter({ hasText: "Version 2" }).filter({ hasText: /Published/ });
    await v2.getByRole("button", { name: "Roll back to this" }).click();
    const dialog = page.getByRole("dialog", { name: "Roll back to version 2?" });
    await expect(dialog).toContainText("Version 2 becomes live for every deployment that follows the latest version.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await agentTab(page, "Versions");
    await expect(editor.locator("div.row.between").filter({ hasText: "Version 4" }).filter({ hasText: /Published/ }).getByText("Live")).toBeVisible();
  });

  test("AC-AGT-002-06: confirming the roll back makes v2 live, shows the toast and records it in the audit log", async ({ browser }) => {
    const { page } = owner;
    await page.goto(agentUrl);
    await agentTab(page, "Versions");
    const editor = page.getByRole("region", { name: "Agent editor" });
    await editor.locator("div.row.between").filter({ hasText: "Version 2" }).filter({ hasText: /Published/ }).getByRole("button", { name: "Roll back to this" }).click();
    await page.getByRole("dialog", { name: "Roll back to version 2?" }).getByRole("button", { name: "Roll back" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Rolled back." })).toHaveText(/Rolled back\. Version 2 is live again for deployments that follow the latest version\./);
    await page.reload();
    await agentTab(page, "Versions");
    await expect(editor.locator("div.row.between").filter({ hasText: "Version 2" }).filter({ hasText: /Published/ }).getByText("Live")).toBeVisible();
    const visitor = await openWidget(browser, latest.key);
    await say(visitor, "Tell me about politics");
    await expect(visitor.widget.getByRole("log")).toContainText("R1: I only talk about food.");
    await page.goto("/audit");
    await expect(page.getByRole("table")).toContainText(/Rolled back/);
  });
});
