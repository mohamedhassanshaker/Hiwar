import { expect, type Browser, type Page } from "@playwright/test";

import { addMember, signUpOwner, type Account } from "./accounts";
import { choosePlan } from "./billing";
import { createLiveDeployment, openConversation, openWidget, readyWorkspace, say, type Visitor } from "./workspace";

/** Turn on the pre-chat form of a deployment, so visitors give the names the inbox shows. */
export async function preChat(page: Page, deploymentUrl: string): Promise<void> {
  await page.goto(deploymentUrl);
  await page.getByRole("tab", { name: "Behavior and quotas" }).click();
  const toggle = page.getByRole("switch", { name: "Pre-chat form" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
}

/** A visitor who fills the pre-chat form with `name` and sends `first`. */
export async function namedVisitor(browser: Browser, key: string, name: string, first: string): Promise<Visitor> {
  const visitor = await openWidget(browser, key);
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}@e2e.local`;
  await visitor.widget.getByLabel("Name").fill(name);
  await visitor.widget.getByLabel("Email").fill(email);
  await visitor.widget.getByLabel("Phone (optional)").fill("+971 50 000 0000");
  await visitor.widget.getByRole("button", { name: "Start chat" }).click();
  await say(visitor, first);
  await expect(visitor.widget.locator(".bubble-ai")).toHaveCount(2);
  return visitor;
}

export interface InboxSeed {
  owner: Account & { org: string };
  khalid: Account;
  orderKey: string;
  cateringKey: string;
  agentUrl: string;
  /** With the AI, on Order site. */
  c1: Visitor;
  /** Waiting for a person, on Order site. */
  c2: Visitor;
  /** With Khalid, on Catering page. */
  c3: Visitor;
}

/**
 * The three conversations of the design's inbox (PLT-006): c1 Omar Hassan with the AI, c2 Fatima
 * Al Ketbi waiting for a person, c3 Rashid Al Mazrouei with Khalid on the Catering page.
 */
export async function inboxSeed(browser: Browser): Promise<InboxSeed> {
  const owner = await signUpOwner(browser, undefined, "Noura Al Suwaidi");
  // The trial allows one deployment; the design's organization is on Growth.
  await choosePlan(owner.page, "Growth");
  const { key: orderKey, deploymentUrl: orderUrl, agentUrl } = await readyWorkspace(owner.page);
  const { key: cateringKey, url: cateringUrl } = await createLiveDeployment(owner.page, "Catering page", "Layla");
  await preChat(owner.page, orderUrl);
  await preChat(owner.page, cateringUrl);
  const khalid = await addMember(browser, owner.page, "Support Agent", "Khalid Saeed");

  const c1 = await namedVisitor(browser, orderKey, "Omar Hassan", "Do you deliver to Sharjah?");
  const c2 = await namedVisitor(browser, orderKey, "Fatima Al Ketbi", "Two falafel wraps are missing from order 4821.");
  await c2.widget.getByRole("button", { name: "Talk to a person" }).click();
  await expect(c2.widget.getByText("Waiting for our team")).toBeVisible();
  const c3 = await namedVisitor(browser, cateringKey, "Rashid Al Mazrouei", "I need a quote for 120 guests on 5 December.");
  await c3.widget.getByRole("button", { name: "Talk to a person" }).click();
  const thread = await openConversation(khalid.page, "pending", "Rashid Al Mazrouei");
  await thread.getByRole("button", { name: "Claim" }).click();
  await expect(thread.locator(".stt")).toHaveText("With Khalid");
  return { owner, khalid, orderKey, cateringKey, agentUrl, c1, c2, c3 };
}

export function listItems(page: Page) {
  return page.getByRole("complementary", { name: "Conversation list" }).getByRole("listitem");
}
