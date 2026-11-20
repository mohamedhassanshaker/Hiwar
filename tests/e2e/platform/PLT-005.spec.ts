import { expect, test } from "@playwright/test";

import { closeContexts, signUpOwner } from "../support/accounts";
import { openWidget, readyWorkspace, waitingConversation } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

test.describe("PLT-005 Accessibility and localisation", () => {
  test("AC-PLT-005-01: every status dot has a text label", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const { key } = await readyWorkspace(owner.page);
    await waitingConversation(browser, key);
    for (const path of ["/conversations", "/knowledge", "/deployments", "/agents", "/team"]) {
      await owner.page.goto(path);
      const dots = owner.page.locator(".stt");
      await expect(dots.first()).toBeVisible();
      for (const dot of await dots.all()) {
        await expect(dot).toHaveText(/\S/);
      }
    }
  });

  test("AC-PLT-005-02: a focused interactive element shows the focus ring", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.goto("/team");
    const ring = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ring").trim());
    const expected = await page.evaluate((c) => {
      const i = document.createElement("i");
      i.style.color = c;
      document.body.appendChild(i);
      const v = getComputedStyle(i).color;
      i.remove();
      return v;
    }, ring);
    for (const target of [page.getByRole("button", { name: "Invite member" }), page.getByRole("switch", { name: "Require 2-step sign-in" }), page.getByLabel("Session length")]) {
      await target.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
      await expect(target).toHaveCSS("outline-style", "solid");
      await expect(target).toHaveCSS("outline-width", "2px");
      await expect(target).toHaveCSS("outline-color", expected);
    }
  });

  test("AC-PLT-005-03: Tab keeps focus inside an open dialog and Escape closes it", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.goto("/team");
    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite member" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("AC-PLT-005-04: the widget in Arabic sets dir=rtl and mirrors layout and bubbles", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const { key } = await readyWorkspace(owner.page);
    const visitor = await openWidget(browser, key, { locale: "ar-AE" });
    const root = visitor.widget.locator(".wg-root");
    await expect(root).toHaveAttribute("dir", "rtl");
    await visitor.widget.getByLabel("اكتب رسالة").fill("مرحبا");
    await visitor.widget.getByLabel("اكتب رسالة").press("Enter");
    const mine = visitor.widget.locator(".bubble-me").first();
    const ai = visitor.widget.locator(".bubble-ai").first();
    await expect(mine).toBeVisible();
    const [m, a, panel] = await Promise.all([mine.boundingBox(), ai.boundingBox(), visitor.widget.locator("section.wg").boundingBox()]);
    // Mirrored: the visitor's bubbles sit on the left edge and the assistant's on the right.
    expect(m!.x - panel!.x).toBeLessThan(panel!.x + panel!.width - (m!.x + m!.width));
    expect(panel!.x + panel!.width - (a!.x + a!.width)).toBeLessThan(a!.x - panel!.x);
  });
});
