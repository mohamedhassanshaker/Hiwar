import { randomBytes } from "node:crypto";

import { and, asc, eq, gt, isNotNull, lt, or, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import type { AgentConfig, DeploymentSettings, NoPersonBehaviour, Visitor } from "@/db/schema";
import { runTurn, type ToolEvent } from "./agent-service";
import { agentSpec, readableSources, toolSpecs } from "./agents";
import { Refused } from "./api";
import { audit } from "./audit";
import { addMessage, announce, close, generations, REASON_TEXT } from "./inbox";
import { recordUnanswered } from "./knowledge";
import { sendMail } from "./mail";
import { addCost, allowance, checkAlerts, countAiConversation } from "./metering";
import { notify } from "./notifications";

/** The visitor side of a conversation: widget sessions, messages, AI turns and handovers (DEP-003, INB-002, INB-003). */

type Conversation = typeof schema.conversations.$inferSelect;
type Deployment = typeof schema.deployments.$inferSelect;

const REOPEN_MS = 24 * 3_600_000;

// ---------------------------------------------------------------- deployments and origins

/** The deployment for a public key; the previous key works during its 7-day grace (DEP-001 FR-004). */
export async function deploymentByKey(key: string): Promise<Deployment | null> {
  const row = await db.query.deployments.findFirst({
    where: or(
      eq(schema.deployments.publicKey, key),
      and(eq(schema.deployments.previousKey, key), gt(schema.deployments.previousKeyExpiresAt, new Date())),
    ),
  });
  return row ?? null;
}

export async function allowedOrigins(deploymentId: string): Promise<string[]> {
  const rows = await db.query.origins.findMany({ where: eq(schema.origins.deploymentId, deploymentId) });
  return rows.map((r) => r.origin);
}

/** The agent configuration a deployment serves: the pinned version or the latest live one (DEP-002 FR-004). */
export async function servedVersion(deployment: Deployment): Promise<{ number: number; config: AgentConfig } | null> {
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, deployment.agentId) });
  const number = deployment.settings.pinnedVersion ?? agent?.liveVersion ?? null;
  if (!number) return null;
  const version = await db.query.agentVersions.findFirst({
    where: and(eq(schema.agentVersions.agentId, deployment.agentId), eq(schema.agentVersions.number, number)),
  });
  return version ? { number, config: version.config } : null;
}

/** Whether the time is inside the agent's operating hours (AGT-001 FR-021). */
export function withinHours(config: AgentConfig, at = new Date()): boolean {
  if (!config.operatingHours.length) return true;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone || "Asia/Dubai", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const time = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  return config.operatingHours.some((r) => r.days.includes(day) && time >= r.from && time <= r.to);
}

// ---------------------------------------------------------------- sessions

export function newVisitorToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The visitor's open or recently closed conversation on this deployment. */
export async function currentConversation(deployment: Deployment, token: string): Promise<Conversation | null> {
  const row = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.deploymentId, deployment.id), eq(schema.conversations.visitorToken, token)),
    orderBy: sql`${schema.conversations.startedAt} desc`,
  });
  if (!row) return null;
  if (row.state === "CLOSED" && row.closedAt && Date.now() - row.closedAt.getTime() > REOPEN_MS) return null;
  return row;
}

async function startConversation(deployment: Deployment, token: string, visitor: Visitor): Promise<Conversation> {
  const served = await servedVersion(deployment);
  if (!served) throw new Refused("This assistant is not published yet.", 409);
  const [{ prior }] = await db
    .select({ prior: sql<number>`count(*)::int` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.deploymentId, deployment.id), eq(schema.conversations.visitorToken, token)));
  const [row] = await db
    .insert(schema.conversations)
    .values({
      orgId: deployment.orgId,
      deploymentId: deployment.id,
      agentId: deployment.agentId,
      agentVersion: served.number,
      visitorToken: token,
      visitor,
      priorChats: prior,
    })
    .returning();
  await db.insert(schema.ownershipEvents).values({ orgId: row.orgId, conversationId: row.id, event: "AI took the conversation", actor: "AI", reasonCode: "first visitor message", version: 1 });
  await addMessage(db, row, "ai", served.config.welcome[visitor.language] || served.config.welcome.en);
  return row;
}

/** Card numbers and Emirates ID numbers, redacted from stored text when the guardrail is on (AGT-001 FR-027). */
export function redact(text: string): string {
  return text
    .replace(/\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g, "[national ID removed]")
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => (luhn(match.replace(/\D/g, "")) ? "[card number removed]" : match));
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

// ---------------------------------------------------------------- visitor messages

export interface VisitorSend {
  deployment: Deployment;
  token: string;
  text: string;
  visitor: Visitor;
}

/** INB-002 FR-017 to FR-019, FR-033: deliver one visitor message to whoever owns the conversation. */
export async function visitorMessage(input: VisitorSend): Promise<{ conversationId: string; runAi: boolean }> {
  const body = input.text.trim().slice(0, 4000);
  if (!body) throw new Refused("Write a message first.");
  const served = await servedVersion(input.deployment);
  if (!served) throw new Refused("This assistant is not published yet.", 409);
  let c = await currentConversation(input.deployment, input.token);
  if (!c) c = await startConversation(input.deployment, input.token, input.visitor);
  if (c.state === "CLOSED") {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.conversations)
        .set({ state: "AI_ACTIVE", ownerUserId: null, closedAt: null, closedBy: null, feedback: null, version: sql`${schema.conversations.version} + 1` })
        .where(and(eq(schema.conversations.id, c!.id), eq(schema.conversations.state, "CLOSED")))
        .returning();
      if (row) {
        await addMessage(tx, row, "event", "Reopened by the visitor.");
        await tx.insert(schema.ownershipEvents).values({ orgId: row.orgId, conversationId: row.id, event: "Reopened by the visitor", actor: "visitor", reasonCode: "reopened", version: row.version });
      }
    });
    c = (await db.query.conversations.findFirst({ where: eq(schema.conversations.id, c.id) }))!;
  }
  const config = (await db.query.agentVersions.findFirst({ where: and(eq(schema.agentVersions.agentId, c.agentId), eq(schema.agentVersions.number, c.agentVersion)) }))?.config ?? served.config;
  const stored = config.guardrails.redact ? redact(body) : body;
  const previous = await db
    .select({ text: schema.messages.text })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, c.id), eq(schema.messages.kind, "visitor")));
  const repeated = previous.some((m) => m.text.trim().toLowerCase() === stored.trim().toLowerCase());
  await addMessage(db, c, "visitor", stored);
  if (repeated) await db.update(schema.conversations).set({ repeatedQuestion: true }).where(eq(schema.conversations.id, c.id));
  if (c.state === "HUMAN_ACTIVE") {
    await addMessage(db, c, "event", "Delivered to the owner only. The AI did not reply.");
  } else if (c.state === "HANDOVER_PENDING") {
    await addMessage(db, c, "event", "Queued. It goes to whoever claims this conversation.");
  }
  await announce(c);
  return { conversationId: c.id, runAi: c.state === "AI_ACTIVE" };
}

/** Moves an AI conversation to Needs a person with a reason code (D-009 codes in INB-001 FR-024). */
export async function requestPerson(conversationId: string, reasonCode: string, eventText: string): Promise<void> {
  const c = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!c || c.state !== "AI_ACTIVE") return;
  const [row] = await db
    .update(schema.conversations)
    .set({ state: "HANDOVER_PENDING", reasonCode, waitingSince: new Date(), handedOver: true, followUpOffered: false, version: sql`${schema.conversations.version} + 1` })
    .where(and(eq(schema.conversations.id, c.id), eq(schema.conversations.version, c.version), eq(schema.conversations.state, "AI_ACTIVE")))
    .returning();
  if (!row) return;
  await addMessage(db, row, "event", eventText);
  await db.insert(schema.ownershipEvents).values({ orgId: row.orgId, conversationId: row.id, event: "Handover requested", actor: "AI", reasonCode, version: row.version });
  await notify(row.orgId, reasonCode === "tool_approval" ? "approval" : "waiting", `${row.visitor.name ?? "A visitor"} is waiting for a person · ${REASON_TEXT[reasonCode] ?? reasonCode}`, `/conversations?c=${row.id}`, row.id);
  generations.get(row.id)?.abort();
  generations.delete(row.id);
  // Outside operating hours the no-person behaviour applies at once (AGT-001 FR-030).
  const config = await configOf(row);
  if (config && !withinHours(config)) await applyNoPerson(row, config.outsideHours);
  await announce(row);
}

/** INB-002 FR-032: the visitor cancels the request; the AI continues. */
export async function cancelRequest(c: Conversation): Promise<void> {
  if (c.state !== "HANDOVER_PENDING") return;
  const [row] = await db
    .update(schema.conversations)
    .set({ state: "AI_ACTIVE", reasonCode: "visitor_cancelled", waitingSince: null, followUpOffered: false, version: sql`${schema.conversations.version} + 1` })
    .where(and(eq(schema.conversations.id, c.id), eq(schema.conversations.version, c.version), eq(schema.conversations.state, "HANDOVER_PENDING")))
    .returning();
  if (!row) return;
  await addMessage(db, row, "event", "The visitor cancelled the request for a person. The AI continues.");
  await db.insert(schema.ownershipEvents).values({ orgId: row.orgId, conversationId: row.id, event: "Request cancelled by the visitor", actor: "visitor", reasonCode: "visitor_cancelled", version: row.version });
  await db.update(schema.notifications).set({ doneAt: new Date() }).where(eq(schema.notifications.subjectId, row.id));
  await announce(row);
}

async function configOf(c: Conversation): Promise<AgentConfig | null> {
  const version = await db.query.agentVersions.findFirst({ where: and(eq(schema.agentVersions.agentId, c.agentId), eq(schema.agentVersions.number, c.agentVersion)) });
  return version?.config ?? null;
}

/** D-010: Keep with the AI, collect contact details and promise follow-up, or show the offline message. */
async function applyNoPerson(c: Conversation, behaviour: NoPersonBehaviour): Promise<void> {
  if (behaviour === "keep_ai") {
    const [row] = await db
      .update(schema.conversations)
      .set({ state: "AI_ACTIVE", waitingSince: null, version: sql`${schema.conversations.version} + 1` })
      .where(and(eq(schema.conversations.id, c.id), eq(schema.conversations.state, "HANDOVER_PENDING")))
      .returning();
    if (row) {
      await addMessage(db, row, "event", "No one claimed it in time, so the AI continues.");
      await db.insert(schema.ownershipEvents).values({ orgId: row.orgId, conversationId: row.id, event: "Back to the AI: no one was available", actor: "system", reasonCode: "no_person", version: row.version });
    }
  } else {
    await db.update(schema.conversations).set({ followUpOffered: true }).where(eq(schema.conversations.id, c.id));
    await addMessage(db, c, "event", behaviour === "offline" ? "No one was available. The visitor sees the offline message." : "No one was available. The visitor was asked for contact details and promised follow-up.");
  }
  await announce(c);
}

// ---------------------------------------------------------------- the AI turn

/** Runs one AI turn and stores it only if the AI still owns the conversation at the same version. */
export async function aiTurn(conversationId: string): Promise<void> {
  const c = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  if (!c || c.state !== "AI_ACTIVE") return;
  const deployment = await db.query.deployments.findFirst({ where: eq(schema.deployments.id, c.deploymentId) });
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, c.orgId) });
  const config = await configOf(c);
  if (!deployment || !org || !config) return;

  const allow = c.aiCounted ? ({ allowed: true, overage: false, rateAed: 0 } as const) : await allowance(org, deployment);
  if (!allow.allowed) {
    const language = c.visitor.language;
    const settings = deployment.settings;
    const message = allow.behaviour === "offline" ? settings.offlineMessage[language] : settings.fallbackMessage[language];
    await addMessage(db, c, "event", `Limit reached (${allow.reason}). The AI did not reply; the visitor saw: "${message}"`);
    if (allow.behaviour === "stop_route") await requestPerson(c.id, "other", "Limit reached: routed to a person.");
    else await db.update(schema.conversations).set({ followUpOffered: true }).where(eq(schema.conversations.id, c.id));
    await announce(c);
    return;
  }

  const lines = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id), orderBy: asc(schema.messages.createdAt) });
  const handback = [...lines].reverse().find((m) => m.kind === "event" && m.meta.reasonCode === "handback_note");
  const transcript = lines
    .filter((m) => m.kind === "visitor" || m.kind === "ai" || m.kind === "staff")
    .slice(-24)
    .map((m) => ({ role: m.kind as "visitor" | "ai" | "staff", text: m.text, name: m.authorName ?? undefined }));

  const pendingWrite = await db.query.toolCalls.findFirst({
    where: and(eq(schema.toolCalls.conversationId, c.id), sql`${schema.toolCalls.status} in ('waiting_approval','waiting_visitor')`),
  });
  const controller = new AbortController();
  generations.set(c.id, controller);
  await announce(c);
  let result;
  try {
    result = await runTurn({
      org_id: c.orgId,
      agent: agentSpec(config),
      transcript,
      language: deployment.settings.languageOverride !== "auto" ? deployment.settings.languageOverride : config.replyLanguage,
      sources: await readableSources(c.orgId, config.excludedSources),
      // INB-003 FR-010: while a write call waits for a decision, no other write tool is offered.
      tools: (await toolSpecs(c.orgId, config, deployment.settings.toolSubset)).filter((t) => t.access === "read" || !pendingWrite),
      handback_note: handback ? handback.text.replace(/^Handed back to the AI with a staff note: "|"\. The visitor does not see the note\.$/g, "") : null,
    });
  } catch (problem) {
    console.error("AI turn failed", problem);
    if (!controller.signal.aborted) await addMessage(db, c, "event", "The AI could not reply (service unavailable).");
    generations.delete(c.id);
    await announce(c);
    return;
  } finally {
    if (generations.get(c.id) === controller) generations.delete(c.id);
  }

  const failedTools = result.tools.filter((t) => t.status === "failed").length;
  const escalation = decideEscalation(c, config, result, failedTools);
  const stored = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.conversations).where(eq(schema.conversations.id, c.id)).for("update");
    // INB-002 FR-004: a take over in between discards the AI reply.
    if (locked.version !== c.version || locked.state !== "AI_ACTIVE") return false;
    await addMessage(tx, c, "ai", config.guardrails.redact ? redact(result.text) : result.text, {
      meta: {
        citations: result.citations.map((x) => ({ sourceId: x.source_id, name: x.name, chunk: x.chunk, confidence: x.confidence })),
        toolCalls: result.tools.map((t) => t.key),
        tokens: { input: result.input_tokens, output: result.output_tokens, costAed: result.cost_aed },
        lowConfidence: result.low_confidence,
      },
    });
    for (const t of result.tools) await storeToolCall(tx, c, t);
    await tx
      .update(schema.conversations)
      .set({
        lowConfidenceStreak: result.low_confidence ? sql`${schema.conversations.lowConfidenceStreak} + 1` : 0,
        toolFailureStreak: failedTools ? sql`${schema.conversations.toolFailureStreak} + ${failedTools}` : result.tools.length ? 0 : sql`${schema.conversations.toolFailureStreak}`,
      })
      .where(eq(schema.conversations.id, c.id));
    if (!(await countAiConversation(tx, locked, { overage: allow.overage, rateAed: allow.rateAed }, result.cost_aed))) await addCost(tx, c.id, result.cost_aed);
    return true;
  });
  if (!stored) return;
  if (result.unanswered) await recordUnanswered(c.orgId, result.unanswered, result.language);
  for (const t of result.tools) {
    if (t.key === "send_transcript" && t.status === "ran") await sendTranscript(c, String(t.inputs.email ?? ""));
    // INB-003 FR-007: write tools that ran automatically are in the audit log too.
    if (t.access === "write" && (t.status === "ran" || t.status === "failed")) {
      await audit({ orgId: c.orgId, actorUserId: null, actorName: "AI", area: "Conversations", action: "Write tool run automatically", item: t.name, change: `${c.visitor.name ?? "Visitor"} · ${t.status}` });
    }
  }
  const waiting = result.tools.find((t) => t.status === "waiting_approval");
  if (waiting) await requestPerson(c.id, "tool_approval", `The AI wants to run ${waiting.name}, which needs staff approval. Reason code: tool_approval.`);
  else if (escalation) await requestPerson(c.id, escalation, `${REASON_TEXT[escalation] ?? "A person was requested"}. Reason code: ${escalation}. Staff notified.`);
  await checkAlerts(org);
  await announce(c);
}

/** D-009: the escalation triggers of the agent version, in priority order. */
function decideEscalation(c: Conversation, config: AgentConfig, result: Awaited<ReturnType<typeof runTurn>>, failedTools: number): string | null {
  const e = config.escalation;
  if (result.escalate === "sensitive_topic") return e.sensitiveTopic ? "sensitive_topic" : null;
  if (result.escalate === "agent_request" && e.agentRequest) return "agent_request";
  if (result.negative && e.negativeSentiment) return "negative_sentiment";
  if (e.lowConfidence && result.low_confidence && c.lowConfidenceStreak + 1 >= e.lowConfidenceCount) return "low_confidence";
  if (e.toolFailure && failedTools > 0 && c.toolFailureStreak + failedTools >= 2) return "tool_failure";
  return null;
}

async function storeToolCall(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], c: Conversation, t: ToolEvent): Promise<void> {
  const status = t.status === "proposed" ? "waiting_approval" : t.status;
  await tx.insert(schema.toolCalls).values({
    orgId: c.orgId,
    conversationId: c.id,
    toolKey: t.key,
    toolName: t.name,
    access: t.access,
    policy: t.policy as "read",
    inputs: t.inputs,
    status,
    durationMs: t.duration_ms ?? null,
    result: (t.result ?? null) as object | null,
  });
}

export async function sendTranscript(c: Conversation, email: string): Promise<void> {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  const lines = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id), orderBy: asc(schema.messages.createdAt) });
  const text = lines
    .filter((m) => m.kind === "visitor" || m.kind === "ai" || m.kind === "staff")
    .map((m) => `${m.kind === "visitor" ? "You" : m.kind === "ai" ? "Assistant" : (m.authorName ?? "Team")}: ${m.text}`)
    .join("\n\n");
  await sendMail(email, "Your conversation transcript", text);
}

// ---------------------------------------------------------------- periodic work

/** Auto-close after the organization's quiet period, and the no-person behaviour after the claim wait. */
export async function sweep(): Promise<void> {
  const open = await db
    .select({ c: schema.conversations, minutes: schema.organizations.autoCloseMinutes })
    .from(schema.conversations)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.conversations.orgId))
    .where(and(eq(schema.conversations.state, "AI_ACTIVE"), lt(schema.conversations.lastVisitorAt, sql`now() - (${schema.organizations.autoCloseMinutes} || ' minutes')::interval`)))
    .limit(200);
  for (const { c } of open) if (!generations.has(c.id)) await close(c, "auto", { userId: null, name: "Hiwar" });

  const waiting = await db.query.conversations.findMany({
    where: and(eq(schema.conversations.state, "HANDOVER_PENDING"), eq(schema.conversations.followUpOffered, false), isNotNull(schema.conversations.waitingSince)),
    limit: 200,
  });
  for (const c of waiting) {
    const config = await configOf(c);
    if (!config || !c.waitingSince) continue;
    if (Date.now() - c.waitingSince.getTime() >= config.escalation.claimWaitMinutes * 60_000) await applyNoPerson(c, config.escalation.noPerson);
  }
}

export function defaultDeploymentSettings(): DeploymentSettings {
  return {
    brandColour: "#4338ca",
    welcome: { en: "", ar: "" },
    position: "right",
    showAiLabel: true,
    suggestedQuestions: true,
    suggestions: { en: ["Where is my order?", "Do you deliver to Sharjah?"], ar: ["أين طلبي؟", "هل توصلون للشارقة؟"] },
    rtl: true,
    pinnedVersion: null,
    languageOverride: "auto",
    toolSubset: null,
    monthlyQuota: null,
    concurrentLimit: 200,
    limitBehaviour: "stop_route",
    preChatForm: false,
    offlineMessage: { en: "We are offline right now. Leave your email and we will reply tomorrow morning.", ar: "نحن غير متاحين الآن. اترك بريدك وسنرد عليك صباح الغد." },
    fallbackMessage: { en: "Our assistant is busy right now. A person from the team will reply here.", ar: "مساعدنا مشغول الآن. سيرد عليك أحد أفراد الفريق هنا." },
  };
}
