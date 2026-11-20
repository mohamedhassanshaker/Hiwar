import { expect, test } from "@playwright/test";

import { closeContexts, signUpOwner } from "../support/accounts";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

test.describe("PLT-001 Product scope, principles and release scope", () => {
  test("AC-PLT-001-01: the P1 product has the inbox actions, every P1 control panel screen, the widget, Home and Pricing", async ({ browser, page }) => {
    for (const [path, heading] of [["/", "A capable AI assistant on your website in minutes. Your team one click away."], ["/pricing", "Plans that grow with your conversations"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
    const { page: panel } = await signUpOwner(browser);
    for (const [path, heading] of [
      ["/conversations", "Conversations"],
      ["/agents", "Agents"],
      ["/knowledge", "Knowledge"],
      ["/deployments", "Deployments"],
      ["/analytics", "Analytics"],
      ["/billing", "Plan and usage"],
      ["/team", "Team and roles"],
      ["/audit", "Audit log"],
    ]) {
      await panel.goto(path);
      await expect(panel.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    // The inbox actions (take over, claim, hand back, release, close) are proven in INB-002;
    // the widget in DEP-003.
  });

  test.fixme("AC-PLT-001-02: P2 items appear only on Pricing with a Planned badge (open question: BIL-001 FR-023 also requires them, with the Planned badge, in Choose a plan on Plan and usage)", async () => {});
  test.fixme("AC-PLT-001-03: P3 items do not appear in the UI (open question: neither the UI specification nor PLT-001 lists the P3 items)", async () => {});
});
