import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { toolSpecs } from "./agents";
import { Refused } from "./api";
import { audit } from "./audit";
import { can } from "./authz";
import { addMessage, announce, loadConversation } from "./inbox";
import type { MemberContext } from "./session";
import { sendTranscript, servedVersion } from "./visitor";
import { executeTool } from "./widget";

/** INB-003: only the conversation's owner, in a role allowed to approve, decides a waiting write call. */

async function waitingCall(member: MemberContext, toolCallId: string) {
  if (!can(member.role, "approve_tools")) throw new Refused("Your role cannot approve tools.", 403);
  const call = await db.query.toolCalls.findFirst({ where: and(eq(schema.toolCalls.id, toolCallId), eq(schema.toolCalls.orgId, member.org.id)) });
  if (!call || call.status !== "waiting_approval") throw new Refused("This call is no longer waiting for approval.", 409);
  const c = await loadConversation(member.org.id, call.conversationId);
  if (c.state !== "HUMAN_ACTIVE" || c.ownerUserId !== member.user.id) throw new Refused("Claim the conversation to approve or reject.", 403);
  return { call, c };
}

export async function approve(member: MemberContext, toolCallId: string): Promise<void> {
  const { call, c } = await waitingCall(member, toolCallId);
  const deployment = await db.query.deployments.findFirst({ where: eq(schema.deployments.id, c.deploymentId) });
  const served = deployment ? await servedVersion(deployment) : null;
  const version = await db.query.agentVersions.findFirst({ where: and(eq(schema.agentVersions.agentId, c.agentId), eq(schema.agentVersions.number, c.agentVersion)) });
  const config = version?.config ?? served?.config;
  const spec = config ? (await toolSpecs(c.orgId, config, deployment?.settings.toolSubset ?? null)).find((s) => s.key === call.toolKey) : undefined;
  // Mark it approved first, so a second click cannot run it twice (FR-004: once).
  const [claimed] = await db
    .update(schema.toolCalls)
    .set({ status: "approved", decidedBy: member.user.id, decidedAt: new Date() })
    .where(and(eq(schema.toolCalls.id, call.id), eq(schema.toolCalls.status, "waiting_approval")))
    .returning();
  if (!claimed) throw new Refused("This call was already decided.", 409);
  const outcome = spec ? await executeTool(spec, call.inputs) : { ok: false, result: { error: "The tool is no longer available" }, duration_ms: 0 };
  await db
    .update(schema.toolCalls)
    .set({ status: outcome.ok ? "ran" : "failed", result: outcome.result as object, durationMs: outcome.duration_ms })
    .where(eq(schema.toolCalls.id, call.id));
  if (outcome.ok && call.toolKey === "send_transcript") await sendTranscript(c, String(call.inputs.email ?? ""));
  await addMessage(db, c, "event", outcome.ok ? `${member.user.name} approved ${call.toolName}. It ran once.` : `${member.user.name} approved ${call.toolName}, but it failed. It was not retried.`);
  await db.insert(schema.ownershipEvents).values({ orgId: c.orgId, conversationId: c.id, event: `${call.toolName} approved`, actor: member.user.name, reasonCode: "tool_approval", version: c.version });
  await audit({ orgId: c.orgId, actorUserId: member.user.id, actorName: member.user.name, area: "Conversations", action: "Approved a write tool", item: call.toolName, change: `${c.visitor.name ?? "Visitor"} · ${outcome.ok ? "ran" : "failed"}` });
  await announce(c);
}

export async function reject(member: MemberContext, toolCallId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Refused("Give a reason for rejecting.");
  const { call, c } = await waitingCall(member, toolCallId);
  await db
    .update(schema.toolCalls)
    .set({ status: "rejected", reason: reason.trim(), decidedBy: member.user.id, decidedAt: new Date() })
    .where(and(eq(schema.toolCalls.id, call.id), eq(schema.toolCalls.status, "waiting_approval")));
  await addMessage(db, c, "event", `${member.user.name} rejected ${call.toolName}: ${reason.trim()}`);
  await db.insert(schema.ownershipEvents).values({ orgId: c.orgId, conversationId: c.id, event: `${call.toolName} rejected`, actor: member.user.name, reasonCode: "tool_approval", version: c.version, note: reason.trim() });
  await audit({ orgId: c.orgId, actorUserId: member.user.id, actorName: member.user.name, area: "Conversations", action: "Rejected a write tool", item: call.toolName, change: reason.trim() });
  await announce(c);
}
