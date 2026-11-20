import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** Mailpit, the mail catcher of the local deployment; `scripts/test-e2e.sh` forwards it. */
export const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
export const password = "e2e-passphrase-123";

let counter = 0;
/** A suffix unique to this run and call, so tests can run against a deployment that already holds data. */
export function unique(label: string): string {
  counter += 1;
  return `${label}-${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

export interface Account {
  name: string;
  email: string;
  password: string;
  page: Page;
}

const opened: BrowserContext[] = [];

/** A page in a browser context of its own (one per actor); `closeContexts` closes it after the file. */
export async function newPage(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const context = await browser.newContext(options);
  opened.push(context);
  return context.newPage();
}

/**
 * Closes every context the file opened. Each spec file calls it in a top-level `test.afterAll`:
 * one worker runs the whole suite, so contexts left open would accumulate for the full run.
 */
export async function closeContexts(): Promise<void> {
  await Promise.all(opened.splice(0).map((context) => context.close().catch(() => undefined)));
}

/** The newest email to `to`, polled until it arrives. */
export async function mailText(page: Page, to: string, subject?: RegExp): Promise<string> {
  let text = "";
  await expect(async () => {
    const search = await page.request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
    const hit = messages.find((m) => !subject || subject.test(m.Subject));
    expect(hit, `an email to ${to}`).toBeTruthy();
    const message = (await (await page.request.get(`${mailpit}/api/v1/message/${hit!.ID}`)).json()) as { Text: string };
    text = message.Text;
  }).toPass({ timeout: 30_000 });
  return text;
}

/** The first link in the newest email to `to` whose path contains `path`. */
export async function mailLink(page: Page, to: string, path: string): Promise<string> {
  let link = "";
  await expect(async () => {
    const match = (await mailText(page, to)).match(new RegExp(`http\\S+${path}\\S+`));
    expect(match, `a ${path} link in the email to ${to}`).toBeTruthy();
    link = match![0];
  }).toPass({ timeout: 30_000 });
  return link;
}

/** Start free, verify the email, land in Conversations: a new organization on its trial (ORG-004). */
export async function signUpOwner(browser: Browser, org = unique("E2E Org"), name = "Noura Test"): Promise<Account & { org: string }> {
  const page = await newPage(browser);
  const email = `${unique("owner")}@e2e.local`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Organization name").fill(org);
  await page.getByRole("button", { name: "Start free" }).click();
  await expect(page.getByRole("status")).toContainText("We sent a verification link");
  await page.goto(await mailLink(page, email, "verify-email"));
  await expect(page).toHaveURL(/\/conversations/);
  return { name, email, password, page, org };
}

export type RoleLabel = "Admin" | "Builder" | "Support Agent" | "Analyst" | "Billing";

/** The owner invites a member with `role`; the member accepts in a browser context of their own. */
export async function addMember(browser: Browser, owner: Page, role: RoleLabel, name = `${role} Test`): Promise<Account> {
  const email = `${unique(role.replace(" ", "").toLowerCase())}@e2e.local`;
  await owner.goto("/team");
  await owner.getByRole("button", { name: "Invite member" }).click();
  await owner.getByLabel("Email").fill(email);
  await owner.getByLabel("Role", { exact: true }).selectOption({ label: role });
  await owner.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByRole("table").getByText(email)).toBeVisible();
  const page = await newPage(browser);
  await page.goto(await mailLink(page, email, "invite"));
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page).toHaveURL(/\/conversations|\/agents|\/analytics|\/billing/);
  return { name, email, password, page };
}

export async function signIn(page: Page, email: string, pass = password): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the outcome, so a following navigation cannot abort the sign-in request: the
  // panel (or 2-step) opens, or the form shows why it refused.
  await expect
    .poll(async () => !new URL(page.url()).pathname.startsWith("/sign-in") || (await page.locator(".form-error, .err:not(:empty)").count()) > 0, { timeout: 15_000 })
    .toBe(true);
}
