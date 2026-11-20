import { expect, test } from "@playwright/test";

import { addMember, closeContexts, mailText, signUpOwner, unique, type Account } from "../support/accounts";
import { choosePlan } from "../support/billing";
import { inboxSeed } from "../support/inbox";
import { openConversation } from "../support/workspace";

// Every browser context this file opened is closed when it ends.
test.afterAll(closeContexts);

function seats(page: Account["page"]) {
  return page.getByText(/\d+ of \d+ seats used\./);
}

test.describe("ORG-001 Team members, invitations and security settings", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Account & { org: string };
  let builder: Account;

  test.beforeAll(async ({ browser }) => {
    owner = await signUpOwner(browser);
    builder = await addMember(browser, owner.page, "Builder", "Mariam Builder");
  });

  test("AC-ORG-001-01: each member row has name, email, role select, 2-step status and last active", async () => {
    const { page } = owner;
    await page.goto("/team");
    await expect(page.getByRole("table").first().getByRole("columnheader")).toHaveText(["Name", "Email", "Role", "2-step sign-in", "Last active", "Actions"]);
    const row = page.getByRole("row").filter({ hasText: builder.email });
    await expect(row.getByRole("cell").first()).toHaveText("Mariam Builder");
    await expect(row.getByRole("combobox", { name: "Role of Mariam Builder" })).toHaveValue("builder");
    await expect(row.locator(".stt")).toHaveText("Off");
    await expect(row.getByRole("cell").nth(4)).toHaveText(/\d+ \w+ \d{2}:\d{2}|Never/);
  });

  test("AC-ORG-001-06: the Owner's role is locked and Remove is not offered", async () => {
    const { page } = owner;
    await page.goto("/team");
    const row = page.getByRole("row").filter({ hasText: owner.email });
    await expect(row.getByRole("combobox")).toHaveCount(0);
    await expect(row.getByTitle("The Owner's role is locked")).toHaveText("Owner");
    await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("AC-ORG-001-02: an invitation with role Billing and a message is emailed, listed as Invited, takes a seat and is audited", async () => {
    const { page } = owner;
    const email = `${unique("huda")}@e2e.local`;
    await page.goto("/team");
    const before = Number((await seats(page).textContent())!.match(/(\d+) of \d+ seats used/)![1]);
    await page.getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite member" });
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Role").selectOption({ label: "Billing" });
    await dialog.getByLabel("Message (optional)").fill("Welcome to the finance side of Gulf Bites.");
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Invitation sent to ${email}.` })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toContainText("Invited");
    await expect(row).toContainText("Billing");
    await expect(seats(page)).toContainText(`${before + 1} of`);
    expect(await mailText(page, email)).toContain("Welcome to the finance side of Gulf Bites.");
    await page.goto("/audit");
    const entry = page.getByRole("row").filter({ hasText: email });
    await expect(entry.getByRole("cell").nth(3)).toHaveText("Invited");
    await expect(entry.getByRole("cell").nth(5)).toHaveText("role Billing");
  });

  test("AC-ORG-001-04: changing a Builder to Analyst applies on their next request and the audit log records 'Builder to Analyst'", async () => {
    await builder.page.goto("/agents");
    await expect(builder.page).toHaveURL(/\/agents/);
    const { page } = owner;
    await page.goto("/team");
    await page.getByRole("combobox", { name: "Role of Mariam Builder" }).selectOption({ label: "Analyst" });
    await expect(page.getByRole("status").filter({ hasText: "Mariam Builder is now Analyst." })).toBeVisible();
    await builder.page.goto("/agents");
    await expect(builder.page).toHaveURL(/denied=1/);
    await expect(builder.page.getByRole("navigation", { name: "Main navigation" })).not.toContainText("Agents");
    await page.goto("/audit");
    await expect(page.getByRole("row").filter({ hasText: "Mariam Builder" }).first()).toContainText("Builder to Analyst");
  });

  test("AC-ORG-001-07: Security has a Require 2-step switch and a session length select of 1, 7, 14 or 30 days defaulting to 14", async () => {
    const { page } = owner;
    await page.goto("/team");
    const security = page.getByRole("region", { name: "Security" });
    await expect(security.getByRole("switch", { name: "Require 2-step sign-in" })).toHaveAttribute("aria-checked", "false");
    await expect(security.getByLabel("Session length").locator("option")).toHaveText(["1 day", "7 days", "14 days", "30 days"]);
    await expect(security.getByLabel("Session length")).toHaveValue("14");
  });

  test.fixme("AC-ORG-001-09: with a 7-day session length a member whose session is older is asked to sign in again (needs a server clock)", async () => {});
});

test("AC-ORG-001-03: when every seat is in use an invitation is refused with the seat limit and an Upgrade link", async ({ browser }) => {
  const owner = await signUpOwner(browser);
  await choosePlan(owner.page, "Starter");
  await addMember(browser, owner.page, "Support Agent");
  const { page } = owner;
  await page.goto("/team");
  await expect(page.getByText("2 of 2 seats used.")).toBeVisible();
  await page.getByRole("button", { name: "Invite member" }).click();
  await page.getByLabel("Email").fill(`${unique("extra")}@e2e.local`);
  await page.getByRole("button", { name: "Send invitation" }).click();
  const alert = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(alert).toContainText(/2 seats/);
  await expect(alert.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "/billing");
});

test("AC-ORG-001-05: a removed member loses access at once, their conversations return to Needs a person with reason released, and the seat is freed", async ({ browser }) => {
  test.setTimeout(300_000);
  const seed = await inboxSeed(browser);
  const { page } = seed.owner;
  await page.goto("/team");
  const before = Number((await page.getByText(/\d+ of \d+ seats used\./).textContent())!.match(/(\d+) of \d+ seats used/)![1]);
  await page.getByRole("row").filter({ hasText: seed.khalid.email }).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog", { name: "Remove Khalid Saeed?" }).getByRole("button", { name: "Remove member" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Khalid Saeed was removed." })).toBeVisible();
  await expect(page.getByText(new RegExp(String.raw`\b${before - 1} of \d+ seats used\.`))).toBeVisible();
  await seed.khalid.page.goto("/conversations");
  await expect(seed.khalid.page).not.toHaveURL(/\/conversations/);
  const thread = await openConversation(page, "pending", "Rashid Al Mazrouei");
  await expect(thread.locator(".stt")).toHaveText("Waiting for a person");
  await expect(page.getByRole("complementary", { name: "Conversation details" })).toContainText("released");
});
