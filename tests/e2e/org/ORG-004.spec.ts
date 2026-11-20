import { expect, test, type Page } from "@playwright/test";

import { addMember, closeContexts, mailLink, mailText, newPage, password, signIn, signUpOwner, unique } from "../support/accounts";
import { totp } from "../support/totp";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

/** The Owner turns the requirement on; it applies to them at once, so they set it up first. */
async function requireTwoStep(owner: Page): Promise<void> {
  await owner.goto("/team");
  await owner.getByRole("switch", { name: "Require 2-step sign-in" }).click();
  await expect(owner).toHaveURL(/\/two-step\/setup/);
  await setUpTwoStep(owner);
  await owner.goto("/team");
  await expect(owner.getByRole("switch", { name: "Require 2-step sign-in" })).toHaveAttribute("aria-checked", "true");
}

/** On the set-up page: read the key, confirm a code, and return the key for later sign-ins. */
async function setUpTwoStep(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: "Set up 2-step sign-in" })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  const secret = (await page.locator(".mono").textContent())!.trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on 2-step sign-in" }).click();
  // Back in the control panel, on the first screen the member's role may open.
  await expect(page).toHaveURL(/\/(conversations|agents|analytics|billing|team)/);
  return secret;
}

test.describe("ORG-004 Sign-up, sign-in, 2-step sign-in and invitations", () => {
  test("AC-ORG-004-01 to -04: Start free, verify the email, land in Conversations on a 14-day trial", async ({ page }) => {
    const email = `${unique("owner")}@e2e.local`;
    await page.goto("/");
    await page.getByRole("link", { name: "Start free" }).first().click();
    for (const label of ["Your name", "Work email", "Password", "Organization name"]) await expect(page.getByLabel(label)).toBeVisible();
    await page.getByLabel("Your name").fill("Noura Test");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill("short");
    await page.getByLabel("Organization name").fill(unique("E2E Bites"));
    await page.getByRole("button", { name: "Start free" }).click();
    await expect(page.getByText("Use at least 12 characters.").first()).toBeVisible();
    await expect(page.getByLabel("Work email")).toHaveValue(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Start free" }).click();
    await expect(page.getByRole("status")).toContainText("We sent a verification link");
    await page.goto("/conversations");
    await expect(page).not.toHaveURL(/\/conversations/);
    await page.goto(await mailLink(page, email, "verify-email"));
    await expect(page).toHaveURL(/\/conversations/);
    await expect(page.getByText("Trial · 14 days left")).toBeVisible();
    await page.goto("/billing");
    await expect(page.getByRole("progressbar", { name: "AI conversations" }).locator("xpath=..")).toContainText("0 of 100");
    await expect(page.getByText("No card yet.", { exact: false })).toBeVisible();

    // An email that is already registered is refused next to the field.
    const again = await newPage(page.context().browser()!);
    await again.goto("/sign-up");
    await again.getByLabel("Your name").fill("Someone Else");
    await again.getByLabel("Work email").fill(email);
    await again.getByLabel("Password").fill(password);
    await again.getByLabel("Organization name").fill(unique("Other"));
    await again.getByRole("button", { name: "Start free" }).click();
    await expect(again.getByLabel("Work email").locator("xpath=..")).toContainText(/already/i);
  });

  test("AC-ORG-004-06: a wrong email or password shows one message that does not say which", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const page = await newPage(browser);
    await signIn(page, owner.email, "wrong-password-123");
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await signIn(page, `${unique("nobody")}@e2e.local`, password);
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  });

  test("AC-ORG-004-07: after 5 failed attempts in 15 minutes the sixth is blocked and the account's email gets a notice", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const page = await newPage(browser);
    for (let i = 0; i < 5; i += 1) {
      await signIn(page, owner.email, `wrong-password-${i}`);
      await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    }
    await signIn(page, owner.email, owner.password);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ }).or(page.locator(".err")).first()).toContainText(/15 minutes/);
    await expect(page).toHaveURL(/\/sign-in/);
    expect(await mailText(page, owner.email, /sign-in|blocked|attempts/i)).toMatch(/15 minutes/);
  });

  test("AC-ORG-004-08, -05, AC-ORG-001-08: when 2-step is required a member sets it up before any screen; later sign-ins ask for the code", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const member = await addMember(browser, owner.page, "Builder");
    await requireTwoStep(owner.page);
    const page = await newPage(browser);
    await signIn(page, member.email);
    await expect(page).toHaveURL(/\/two-step\/setup/);
    await page.goto("/agents");
    await expect(page).toHaveURL(/\/two-step\/setup/);
    const secret = await setUpTwoStep(page);

    const later = await newPage(browser);
    await signIn(later, member.email);
    await expect(later).toHaveURL(/\/two-step/);
    await expect(later.getByLabel("6-digit code")).toBeVisible();
    await later.getByLabel("6-digit code").fill("000000");
    await later.getByRole("button", { name: "Continue" }).click();
    await expect(later.getByText("That code is not valid.", { exact: false })).toBeVisible();
    await later.getByLabel("6-digit code").fill(totp(secret));
    await later.getByRole("button", { name: "Continue" }).click();
    await expect(later).toHaveURL(/\/conversations|\/agents/);
  });

  test.fixme("AC-ORG-004-09: a session older than the organization's session length shows 'Your session has expired…' and returns to the same page after sign-in (needs a server clock; the shortest session length is 1 day)", async () => {});

  test("AC-ORG-004-10: Sign out ends the session and opens the public Home", async ({ browser }) => {
    const { page } = await signUpOwner(browser);
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/conversations");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("AC-ORG-004-11: an invitee who sets name and password joins with the invited role and the audit log records it", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const analyst = await addMember(browser, owner.page, "Analyst", "Yousef Darwish");
    const nav = analyst.page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toContainText("Analytics");
    await expect(nav).not.toContainText("Agents");
    await owner.page.goto("/team");
    await expect(owner.page.getByRole("row").filter({ hasText: analyst.email })).toContainText("Analyst");
    await owner.page.goto("/audit");
    await expect(owner.page.getByRole("row").filter({ hasText: "Yousef Darwish" }).first()).toContainText(/joined/i);
  });

  test("AC-ORG-004-12: a cancelled invitation's link says it is no longer valid and to ask for a new one", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const email = `${unique("cancelled")}@e2e.local`;
    await owner.page.goto("/team");
    await owner.page.getByRole("button", { name: "Invite member" }).click();
    await owner.page.getByLabel("Email").fill(email);
    await owner.page.getByRole("button", { name: "Send invitation" }).click();
    const link = await mailLink(owner.page, email, "invite");
    await owner.page.getByRole("row").filter({ hasText: email }).getByRole("button", { name: "Cancel" }).click();
    await expect(owner.page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    const page = await newPage(browser);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "This invitation is no longer valid" })).toBeVisible();
    await expect(page.getByText("Ask the person who invited you for a new one.")).toBeVisible();
  });

  test.fixme("AC-ORG-004-12: an invitation older than 7 days is no longer valid (needs a server clock)", async () => {});

  test("AC-ORG-004-13, -14: Forgot password answers the same for any email; the link works once and ends the member's other sessions", async ({ browser }) => {
    const owner = await signUpOwner(browser);
    const page = await newPage(browser);
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password" }).click();
    await page.getByLabel("Email").fill(`${unique("nobody")}@e2e.local`);
    await page.getByRole("button", { name: "Send link" }).click();
    const unknown = (await page.getByRole("status").textContent())!;
    expect(unknown).toMatch(/if .*account/i);
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(owner.email);
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByRole("status")).toHaveText(unknown);

    const link = await mailLink(page, owner.email, "reset-password");
    await page.goto(link);
    await page.getByLabel("New password").fill("a-brand-new-passphrase");
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByRole("status")).toHaveText("Your password is changed and your other sessions are signed out. Sign in with the new password.");

    // AC-ORG-004-14: the session that was open before the reset has ended.
    await owner.page.goto("/agents");
    await expect(owner.page).toHaveURL(/\/sign-in/);

    const reuse = await newPage(browser);
    await reuse.goto(link);
    await reuse.getByLabel("New password").fill("another-passphrase-456");
    await reuse.getByRole("button", { name: "Save password" }).click();
    await expect(reuse.getByText("This link is no longer valid. Ask for a new one.")).toBeVisible();
    await signIn(reuse, owner.email, "a-brand-new-passphrase");
    await expect(reuse).toHaveURL(/\/conversations/);
  });

  test.fixme("AC-ORG-004-13: the reset link stops working after 1 hour (needs a server clock)", async () => {});
  test.fixme("AC-ORG-004-15: with 3 trial days left the Owner gets an email and a bell notification with Choose a plan (needs a server clock or a configurable trial length)", async () => {});
  test.fixme("AC-ORG-004-16: after the trial ends without a plan the widget is offline and members see 'Trial ended · choose a plan' (needs a server clock or a configurable trial length)", async () => {});
  test.fixme("AC-ORG-004-17: 90 days after the trial ended the data is deleted after notices 30 and 7 days before (needs a server clock)", async () => {});
});
