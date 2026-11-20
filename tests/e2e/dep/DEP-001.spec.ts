import { expect, test, type Page } from "@playwright/test";

import { baseUrl, closeContexts, mailText, signUpOwner, unique, type Account } from "../support/accounts";
import { addFaq, createAgent, createDeployment } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

async function originsTab(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("tab", { name: "Allowed origins" }).click();
}

/** Whether the widget frame on the demo customer page for `key` shows its launcher. */
async function widgetLoads(page: Page, key: string): Promise<void> {
  await page.goto(`/demo-site/${key}`);
  await expect(page.frameLocator("iframe[title=Chat]").getByRole("button", { name: "Open chat" })).toBeVisible();
}

test.describe("DEP-001 Deployment install, keys, origins and go-live", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account;
  let draft: { key: string; url: string };
  let live: { key: string; url: string };

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
    await addFaq(owner.page, "Do you deliver to Sharjah?", "Yes. We deliver to Sharjah until midnight on weekdays.");
    await createAgent(owner.page, "Layla");
    await createAgent(owner.page, "Salim");
  });

  test("AC-DEP-001-01: New deployment with a name and an agent creates a Draft with a pk_dep_ key, listed with status and agent", async () => {
    const { page } = owner;
    draft = await createDeployment(page, "Catering page", "Salim");
    expect(draft.key).toMatch(/^pk_dep_\w+$/);
    const item = page.getByRole("complementary", { name: "Deployments" }).getByRole("listitem").filter({ hasText: "Catering page" });
    await expect(item.locator(".stt")).toHaveText("Draft");
    await expect(item).toContainText("Salim");
    await page.goto("/deployments");
    await expect(page.getByRole("complementary", { name: "Deployments" }).getByRole("listitem").filter({ hasText: "Catering page" })).toBeVisible();
  });

  test("AC-DEP-001-02: Install shows the snippet with Copy, Send to developer, Verify domain and Rotate key; Copy puts the snippet on the clipboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await owner.page.context().storageState(), permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await page.goto(draft.url);
    const snippet = page.getByLabel("Embed snippet");
    await expect(snippet).toContainText(draft.key);
    for (const name of ["Copy", "Send to developer", "Verify domain", "Rotate key"]) await expect(page.getByRole("button", { name })).toBeVisible();
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Snippet copied." })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await snippet.textContent());
    await context.close();
  });

  test("AC-DEP-001-03: Send to developer emails the snippet and install steps and confirms", async () => {
    const { page } = owner;
    const developer = `${unique("dev")}@e2e.local`;
    await page.goto(draft.url);
    await page.getByRole("button", { name: "Send to developer" }).click();
    const dialog = page.getByRole("dialog", { name: "Send to developer" });
    await dialog.getByLabel("Developer's email").fill(developer);
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Install steps sent to ${developer}.` })).toBeVisible();
    expect(await mailText(page, developer)).toContain(draft.key);
  });

  test("AC-DEP-001-05: Make live with no verified origin keeps the deployment Draft and says an origin must be verified", async () => {
    const { page } = owner;
    await page.goto(draft.url);
    await expect(page.getByText("A deployment cannot go live until an origin is verified.")).toBeVisible();
    await page.getByRole("button", { name: "Make live" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Verify an allowed origin first.");
    await page.reload();
    await expect(page.getByRole("complementary", { name: "Deployments" }).getByRole("listitem").filter({ hasText: "Catering page" }).locator(".stt")).toHaveText("Draft");
  });

  test("AC-DEP-001-04: Verify marks an origin whose page has the snippet as verified; a page without it stays unverified with the reason", async () => {
    const { page } = owner;
    await originsTab(page, draft.url);
    await page.getByLabel("Add an origin").fill(`${baseUrl}/pricing`);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const rows = page.locator("div.row.between").filter({ has: page.getByRole("button", { name: "Verify" }) });
    await expect(rows).toHaveCount(1);
    await rows.getByRole("button", { name: "Verify" }).click();
    await expect(rows.getByText("Not verified: Snippet not found on the page")).toBeVisible();
    await rows.getByRole("button", { name: /^Remove / }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(rows).toHaveCount(0);

    await page.getByLabel("Add an origin").fill(`${baseUrl}/demo-site/${draft.key}`);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await rows.getByRole("button", { name: "Verify" }).click();
    await expect(rows.getByText("Verified", { exact: true })).toBeVisible();
  });

  test("AC-DEP-001-06: Make live with a verified origin makes the deployment Live and the widget loads there", async () => {
    const { page } = owner;
    await page.goto(draft.url);
    await page.getByRole("button", { name: "Make live" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Catering page is live." })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Deployments" }).getByRole("listitem").filter({ hasText: "Catering page" }).locator(".stt")).toHaveText("Live");
    await widgetLoads(page, draft.key);
    live = draft;
  });

  test("AC-DEP-001-07: the widget does not load on an origin that is not listed", async ({ browser }) => {
    const snippet = (await owner.page.goto(live.url), await owner.page.getByLabel("Embed snippet").textContent())!;
    const context = await browser.newContext();
    const page = await context.newPage();
    // A customer site on another domain that pasted this deployment's snippet without being listed.
    await page.route("https://unlisted-shop.e2e.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><h1>Another shop</h1>${snippet}</body></html>` }),
    );
    await page.goto("https://unlisted-shop.e2e.example/");
    await expect(page.getByRole("heading", { name: "Another shop" })).toBeVisible();
    await expect(page.frameLocator("iframe[title=Chat]").getByRole("button", { name: "Open chat" })).toHaveCount(0, { timeout: 10_000 });
    await context.close();
  });

  test("AC-DEP-001-09: Pause shows the offline message in the widget; Make live returns it to Live", async () => {
    const { page } = owner;
    await page.goto(live.url);
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Paused. The widget shows the offline message." })).toBeVisible();
    await expect(page.locator("h2 + span .stt").first()).toHaveText("Paused");
    const visitor = await page.context().browser()!.newContext();
    const vp = await visitor.newPage();
    await vp.goto(`/demo-site/${live.key}`);
    await vp.frameLocator("iframe[title=Chat]").getByRole("button", { name: "Open chat" }).click();
    await expect(vp.frameLocator("iframe[title=Chat]").getByText("We are offline right now", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Make live" }).click();
    await expect(page.locator("h2 + span .stt").first()).toHaveText("Live");
    await vp.reload();
    await vp.frameLocator("iframe[title=Chat]").getByRole("button", { name: "Open chat" }).click();
    await expect(vp.frameLocator("iframe[title=Chat]").getByLabel("Write a message")).toBeVisible();
    await visitor.close();
  });

  test("AC-DEP-001-08: Rotate key issues a new key in the snippet, the old key keeps working, and the audit log records it", async ({ browser }) => {
    const { page } = owner;
    await page.goto(live.url);
    await page.getByRole("button", { name: "Rotate key" }).click();
    await page.getByRole("dialog", { name: "Rotate the public key?" }).getByRole("button", { name: "Rotate key" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Key rotated. The old key works for 7 more days." })).toBeVisible();
    await expect(page.getByLabel("Embed snippet")).not.toContainText(live.key);
    const fresh = (await page.getByLabel("Embed snippet").textContent())!.match(/pk_dep_\w+/)![0];
    await expect(page.getByText(/the previous key works until \d+ \w+/)).toBeVisible();
    const visitor = await browser.newContext();
    await widgetLoads(await visitor.newPage(), live.key);
    await visitor.close();
    expect(fresh).not.toBe(live.key);
    await page.goto("/audit");
    const row = page.getByRole("row").filter({ hasText: "Rotated the key" });
    await expect(row).toContainText("old key valid for 7 days");
  });

  test.fixme("AC-DEP-001-08: the old key stops working after the 7-day grace period (needs a configurable key grace period or server clock)", async () => {});

});
