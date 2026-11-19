import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import type { DeploymentSettings } from "@/db/schema";
import { Refused } from "./api";
import { audit } from "./audit";
import { isHex } from "./contrast";
import { env } from "./env";
import { publish } from "./live";
import { sendMail } from "./mail";
import { orgPlan } from "./plans";
import type { MemberContext } from "./session";
import { defaultDeploymentSettings } from "./visitor";

/** DEP-001 and DEP-002. */

const GRACE_DAYS = 7;

export function newPublicKey(): string {
  return `pk_dep_${randomBytes(12).toString("hex")}`;
}

export function snippet(publicKey: string): string {
  return `<script src="${env().APP_URL}/widget.js" data-deployment="${publicKey}" async></script>`;
}

async function own(orgId: string, id: string) {
  const row = await db.query.deployments.findFirst({ where: and(eq(schema.deployments.id, id), eq(schema.deployments.orgId, orgId)) });
  if (!row) throw new Refused("This deployment does not exist.", 404);
  return row;
}

function log(member: MemberContext, action: string, item: string, change = "") {
  return audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Deployments", action, item, change });
}

export async function listDeployments(orgId: string) {
  const rows = await db
    .select({ d: schema.deployments, agentName: sql<string>`${schema.agents.draft}->>'name'`, agentLive: schema.agents.liveVersion })
    .from(schema.deployments)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.deployments.agentId))
    .where(eq(schema.deployments.orgId, orgId))
    .orderBy(schema.deployments.createdAt);
  return rows;
}

/** FR-009 (D-029): a new deployment starts as Draft with its own key. */
export async function createDeployment(member: MemberContext, name: string, agentId: string): Promise<string> {
  if (!name.trim()) throw new Refused("Enter a name.");
  const { limits } = await orgPlan(member.org);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.deployments).where(eq(schema.deployments.orgId, member.org.id));
  if (count >= limits.deployments) throw new Refused(`Your plan allows ${limits.deployments} deployment${limits.deployments > 1 ? "s" : ""}. Upgrade to add more.`, 402, { upgrade: true });
  const agent = await db.query.agents.findFirst({ where: and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, member.org.id)) });
  if (!agent) throw new Refused("Choose an agent.");
  const [row] = await db
    .insert(schema.deployments)
    .values({ orgId: member.org.id, name: name.trim(), agentId, publicKey: newPublicKey(), settings: defaultDeploymentSettings() })
    .returning({ id: schema.deployments.id });
  await log(member, "Created a deployment", name.trim(), `agent ${agent.draft.name}`);
  return row.id;
}

/** FR-004, FR-011: a new key; the old one works for 7 days. */
export async function rotateKey(member: MemberContext, id: string): Promise<void> {
  const d = await own(member.org.id, id);
  await db
    .update(schema.deployments)
    .set({ publicKey: newPublicKey(), previousKey: d.publicKey, previousKeyExpiresAt: new Date(Date.now() + GRACE_DAYS * 86_400_000) })
    .where(eq(schema.deployments.id, d.id));
  await log(member, "Rotated the key", d.name, `old key valid for ${GRACE_DAYS} days`);
}

export async function sendToDeveloper(member: MemberContext, id: string, email: string): Promise<void> {
  if (!z.string().email().safeParse(email).success) throw new Refused("Enter a valid email address.");
  const d = await own(member.org.id, id);
  await sendMail(
    email,
    `Install the ${member.org.name} chat widget`,
    `${member.user.name} asked you to install the Hiwar chat widget on ${d.name}.\n\n1. Paste this line before </body> on every page:\n\n${snippet(d.publicKey)}\n\n2. Tell ${member.user.name} the site's address so it can be verified in Hiwar.\n`,
  );
}

export function normaliseOrigin(input: string): string {
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (!/^https?:$/.test(url.protocol)) throw new Refused("Use an http or https address.");
  return url.origin;
}

export async function addOrigin(member: MemberContext, id: string, raw: string): Promise<void> {
  const d = await own(member.org.id, id);
  let origin: string;
  let checkUrl: string;
  try {
    origin = normaliseOrigin(raw.trim());
    checkUrl = new URL(raw.trim().includes("://") ? raw.trim() : `https://${raw.trim()}`).toString();
  } catch {
    throw new Refused("Enter a site address such as https://example.com.");
  }
  await db.insert(schema.origins).values({ orgId: member.org.id, deploymentId: d.id, origin, checkUrl }).onConflictDoUpdate({ target: [schema.origins.deploymentId, schema.origins.origin], set: { checkUrl } });
  await log(member, "Added an allowed origin", d.name, origin);
}

/** FR-012: removing the last verified origin of a live deployment pauses it (the client confirms first). */
export async function removeOrigin(member: MemberContext, id: string, originId: string): Promise<{ paused: boolean }> {
  const d = await own(member.org.id, id);
  const [removed] = await db.delete(schema.origins).where(and(eq(schema.origins.id, originId), eq(schema.origins.deploymentId, d.id))).returning();
  if (!removed) return { paused: false };
  await log(member, "Removed an allowed origin", d.name, removed.origin);
  const [{ verified }] = await db.select({ verified: sql<number>`count(*)::int` }).from(schema.origins).where(and(eq(schema.origins.deploymentId, d.id), isNotNull(schema.origins.verifiedAt)));
  if (d.status === "live" && verified === 0) {
    await db.update(schema.deployments).set({ status: "paused" }).where(eq(schema.deployments.id, d.id));
    await log(member, "Paused", d.name, "no verified origin left");
    return { paused: true };
  }
  return { paused: false };
}

const PRIVATE = new BlockList();
for (const [net, prefix] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["127.0.0.0", 8], ["169.254.0.0", 16], ["0.0.0.0", 8], ["100.64.0.0", 10]] as const) PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::1", 128], ["fc00::", 7], ["fe80::", 10], ["::", 128]] as const) PRIVATE.addSubnet(net, prefix, "ipv6");

/** Refuses hosts that resolve to private addresses, so verification cannot probe the internal network. */
async function publicHost(hostname: string): Promise<boolean> {
  if (process.env.ALLOW_PRIVATE_EGRESS === "1") return true;
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  return addresses.every((a) => !PRIVATE.check(a.address, a.family === 6 ? "ipv6" : "ipv4"));
}

/** FR-010 (D-029): the origin's page must contain the snippet with this deployment's key. */
export async function verifyOrigin(member: MemberContext, id: string, originId: string): Promise<{ verified: boolean; reason?: string }> {
  const d = await own(member.org.id, id);
  const origin = await db.query.origins.findFirst({ where: and(eq(schema.origins.id, originId), eq(schema.origins.deploymentId, d.id)) });
  if (!origin) throw new Refused("This origin does not exist.", 404);
  let reason: string | null = null;
  try {
    const page = origin.checkUrl ?? origin.origin;
    const url = new URL(page);
    if (!(await publicHost(url.hostname))) reason = "The address points to a private network";
    else {
      const response = await fetch(page, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "HiwarVerify/1.0" } });
      const html = (await response.text()).slice(0, 2_000_000);
      if (!response.ok) reason = `The page answered ${response.status}`;
      else if (!html.includes(d.publicKey) && !(d.previousKey && html.includes(d.previousKey))) reason = "Snippet not found on the page";
    }
  } catch (problem) {
    reason = `The page could not be reached: ${problem instanceof Error ? problem.message : String(problem)}`;
  }
  await db.update(schema.origins).set({ verifiedAt: reason ? null : new Date(), reason }).where(eq(schema.origins.id, origin.id));
  if (!reason) await log(member, "Verified an allowed origin", d.name, origin.origin);
  return reason ? { verified: false, reason } : { verified: true };
}

/** FR-007, FR-008: Make live needs a verified origin and a published agent version. */
export async function setStatus(member: MemberContext, id: string, status: "live" | "paused"): Promise<void> {
  const d = await own(member.org.id, id);
  if (status === "live") {
    const [{ verified }] = await db.select({ verified: sql<number>`count(*)::int` }).from(schema.origins).where(and(eq(schema.origins.deploymentId, d.id), isNotNull(schema.origins.verifiedAt)));
    if (verified === 0) throw new Refused("Verify an allowed origin first. A deployment cannot go live until an origin is verified.", 409);
    const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, d.agentId) });
    if (!agent?.liveVersion && !d.settings.pinnedVersion) throw new Refused("Publish the agent first.", 409);
  }
  await db.update(schema.deployments).set({ status }).where(eq(schema.deployments.id, d.id));
  await log(member, status === "live" ? "Made live" : "Paused", d.name);
  await publish(`dep:${d.id}`, { type: "status" });
}

export const settingsSchema = z.object({
  brandColour: z.string().refine(isHex, "Use a colour such as #4338ca."),
  welcome: z.object({ en: z.string().max(300), ar: z.string().max(300) }),
  position: z.enum(["right", "left"]),
  showAiLabel: z.boolean(),
  suggestedQuestions: z.boolean(),
  suggestions: z.object({ en: z.array(z.string().max(80)).max(4), ar: z.array(z.string().max(80)).max(4) }),
  rtl: z.boolean(),
  pinnedVersion: z.number().int().positive().nullable(),
  languageOverride: z.enum(["auto", "ar", "en"]),
  toolSubset: z.array(z.string()).nullable(),
  monthlyQuota: z.number().int().positive().nullable(),
  concurrentLimit: z.number().int().min(1).max(100_000),
  limitBehaviour: z.enum(["stop_route", "offline", "overage"]),
  preChatForm: z.boolean(),
  offlineMessage: z.object({ en: z.string().max(300), ar: z.string().max(300) }),
  fallbackMessage: z.object({ en: z.string().max(300), ar: z.string().max(300) }),
});

export async function saveSettings(member: MemberContext, id: string, input: unknown): Promise<void> {
  const d = await own(member.org.id, id);
  const next = settingsSchema.parse(input) as DeploymentSettings;
  if (next.limitBehaviour === "overage" && member.org.limitBehaviour !== "overage") {
    throw new Refused("Turn on capped overage in Plan and usage first.", 409);
  }
  if (next.pinnedVersion) {
    const exists = await db.query.agentVersions.findFirst({ where: and(eq(schema.agentVersions.agentId, d.agentId), eq(schema.agentVersions.number, next.pinnedVersion)) });
    if (!exists) throw new Refused(`Version ${next.pinnedVersion} does not exist.`);
  }
  const changed = (Object.keys(next) as (keyof DeploymentSettings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(d.settings[k]));
  await db.update(schema.deployments).set({ settings: next }).where(eq(schema.deployments.id, d.id));
  if (changed.length) await log(member, "Changed settings", d.name, changed.join(", "));
  await publish(`dep:${d.id}`, { type: "settings" });
}

export async function changeAgent(member: MemberContext, id: string, agentId: string): Promise<void> {
  const d = await own(member.org.id, id);
  const agent = await db.query.agents.findFirst({ where: and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, member.org.id)) });
  if (!agent) throw new Refused("Choose an agent.");
  await db.update(schema.deployments).set({ agentId, settings: { ...d.settings, pinnedVersion: null, toolSubset: null } }).where(eq(schema.deployments.id, d.id));
  await log(member, "Changed the agent", d.name, agent.draft.name);
}
