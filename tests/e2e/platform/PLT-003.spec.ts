import { expect, test } from "@playwright/test";

import { closeContexts, newPage, signUpOwner, type Account } from "../support/accounts";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

test.describe("PLT-003 Control panel shell and navigation", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account & { org: string };

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
  });

  test("AC-PLT-003-01: the sidebar has the groups Build, Operate, Organization and Help and support", async () => {
    const nav = owner.page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.locator(".nav-group")).toHaveText(["Build", "Operate", "Organization"]);
    await expect(nav.locator(".nav-item")).toHaveText([
      "Agents",
      "Knowledge",
      "Deployments",
      "Conversations",
      "Analytics",
      "Plan and usage",
      "Team and roles",
      "Audit log",
      "Help and support",
    ]);
  });

  test("AC-PLT-003-02: the current screen is highlighted and the breadcrumb reads '{org} › {screen}'", async () => {
    const { page, org } = owner;
    const screens: [string, string][] = [
      ["/agents", "Agents"],
      ["/knowledge", "Knowledge"],
      ["/deployments", "Deployments"],
      ["/conversations", "Conversations"],
      ["/analytics", "Analytics"],
      ["/billing", "Plan and usage"],
      ["/team", "Team and roles"],
      ["/audit", "Audit log"],
    ];
    for (const [path, label] of screens) {
      await page.goto(path);
      const nav = page.getByRole("navigation", { name: "Main navigation" });
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(`${org}›${label}`);
    }
  });

  test("AC-PLT-003-03: choosing عربي shows the planned-Arabic toast", async () => {
    const { page } = owner;
    await page.goto("/conversations");
    await page.getByRole("group", { name: "Interface language" }).getByRole("button", { name: "عربي" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Arabic control panel is planned" })).toContainText(
      "The Arabic control panel is planned for the full design. Arabic and right-to-left are shown in the widget preview.",
    );
  });

  test("AC-PLT-003-04: on a narrow screen the menu button opens the sidebar", async ({ browser }) => {
    const page = await newPage(browser, { viewport: { width: 390, height: 844 }, storageState: await owner.page.context().storageState() });
    await page.goto("/conversations");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Agents" })).not.toBeInViewport();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(nav.getByRole("link", { name: "Agents" })).toBeInViewport();
    await nav.getByRole("link", { name: "Agents" }).click();
    await expect(page).toHaveURL(/\/agents/);
  });

  test("AC-PLT-003-05: Sign out in the user chip returns to the public Home", async () => {
    const { page } = owner;
    await page.goto("/conversations");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
