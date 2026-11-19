import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import type { AgentConfig, ToolPolicy } from "@/db/schema";
import { runTurn, type ToolSpec, type TurnLine, type TurnResult } from "./agent-service";
import { Refused } from "./api";
import { audit } from "./audit";
import { openText, sealText } from "./crypto";
import { orgPlan } from "./plans";
import type { MemberContext } from "./session";

/** AGT-001 to AGT-003: agents, tools, versions and the test console. */

export const BUILTIN_TOOLS: { key: string; name: string; description: string; access: "read" | "write"; schema: Record<string, unknown> }[] = [
  {
    key: "capture_lead",
    name: "Capture lead",
    description: "Name, contact and notes",
    access: "read",
    schema: {
      type: "object",
      properties: { name: { type: "string" }, contact: { type: "string", description: "Email or phone" }, notes: { type: "string" } },
      required: ["name", "contact"],
    },
  },
  {
    key: "request_person",
    name: "Request a person",
    description: "Hands the chat to the team with a reason",
    access: "read",
    schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
  {
    key: "send_transcript",
    name: "Send transcript by email",
    description: "Emails the visitor a copy",
    access: "write",
    schema: { type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] },
  },
];

export function defaultAgentConfig(name = "New agent"): AgentConfig {
  return {
    name,
    purpose: "Customer support",
    model: "fast",
    replyLanguage: "auto",
    tone: "warm",
    instructions: "",
    creativity: 3,
    replyLength: "short",
    operatingHours: [{ days: [0, 1, 2, 3, 4], from: "09:00", to: "23:00" }, { days: [5, 6], from: "12:00", to: "23:59" }],
    timezone: "Asia/Dubai",
    outsideHours: "collect_contact",
    excludedSources: [],
    tools: {
      capture_lead: { enabled: true },
      request_person: { enabled: true },
      send_transcript: { enabled: false, policy: "staff_approval" },
    },
    allowedTopics: "",
    blockedTopics: "",
    refusalMessage: "I can help with questions about our business. For anything else I can connect you to a person.",
    guardrails: { discloseAi: true, citations: true, sayUnsure: true, redact: true },
    escalation: {
      talkToPerson: true,
      agentRequest: true,
      lowConfidence: true,
      negativeSentiment: true,
      sensitiveTopic: true,
      toolFailure: true,
      lowConfidenceCount: 3,
      claimWaitMinutes: 2,
      noPerson: "collect_contact",
    },
    welcome: { en: "Hi! How can I help you today?", ar: "مرحبًا! كيف أقدر أساعدك اليوم؟" },
  };
}

const policy = z.enum(["ask_visitor", "staff_approval", "auto"]);
const behaviour = z.enum(["keep_ai", "collect_contact", "offline"]);

export const agentConfigSchema = z.object({
  name: z.string().trim().min(1, "Enter the name shown to visitors.").max(60),
  purpose: z.string().trim().max(80),
  model: z.enum(["fast", "standard", "advanced"]),
  replyLanguage: z.enum(["auto", "ar", "en"]),
  tone: z.enum(["warm", "short", "formal"]),
  instructions: z.string().max(8000),
  creativity: z.number().int().min(0).max(10),
  replyLength: z.enum(["short", "balanced", "detailed"]),
  operatingHours: z.array(z.object({ days: z.array(z.number().int().min(0).max(6)), from: z.string().regex(/^\d\d:\d\d$/), to: z.string().regex(/^\d\d:\d\d$/) })).max(7),
  timezone: z.string().max(60),
  outsideHours: behaviour,
  excludedSources: z.array(z.string().uuid()).max(500),
  tools: z.record(z.string(), z.object({ enabled: z.boolean(), policy: policy.optional() })),
  allowedTopics: z.string().max(2000),
  blockedTopics: z.string().max(2000),
  refusalMessage: z.string().max(500),
  guardrails: z.object({ discloseAi: z.boolean(), citations: z.boolean(), sayUnsure: z.boolean(), redact: z.boolean() }),
  escalation: z.object({
    talkToPerson: z.boolean(),
    agentRequest: z.boolean(),
    lowConfidence: z.boolean(),
    negativeSentiment: z.boolean(),
    sensitiveTopic: z.boolean(),
    toolFailure: z.boolean(),
    lowConfidenceCount: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    claimWaitMinutes: z.number().int().min(1).max(10),
    noPerson: behaviour,
  }),
  welcome: z.object({ en: z.string().max(300), ar: z.string().max(300) }),
});

async function ownAgent(orgId: string, agentId: string) {
  const agent = await db.query.agents.findFirst({ where: and(eq(schema.agents.id, agentId), eq(schema.agents.orgId, orgId)) });
  if (!agent) throw new Refused("This agent does not exist.", 404);
  return agent;
}

export async function listAgents(orgId: string) {
  return db.query.agents.findMany({ where: eq(schema.agents.orgId, orgId), orderBy: schema.agents.createdAt });
}

export async function versionsOf(orgId: string, agentId: string) {
  return db
    .select({
      number: schema.agentVersions.number,
      publishedAt: schema.agentVersions.publishedAt,
      publishedBy: schema.users.name,
    })
    .from(schema.agentVersions)
    .leftJoin(schema.users, eq(schema.users.id, schema.agentVersions.publishedBy))
    .where(and(eq(schema.agentVersions.orgId, orgId), eq(schema.agentVersions.agentId, agentId)))
    .orderBy(desc(schema.agentVersions.number));
}

/** The plan rules an agent configuration must follow (AGT-001 FR-008, FR-015). */
async function checkPlan(member: MemberContext, config: AgentConfig): Promise<void> {
  const { limits } = await orgPlan(member.org);
  if (!limits.models.includes(config.model)) throw new Refused("This model is not available on your plan.", 402, { upgrade: true });
  if (!limits.httpTools) {
    const httpEnabled = Object.entries(config.tools).some(([key, t]) => t.enabled && !BUILTIN_TOOLS.some((b) => b.key === key));
    if (httpEnabled) throw new Refused("HTTP tools need the Growth plan or above.", 402, { upgrade: true });
  }
}

export async function createAgent(member: MemberContext, from?: AgentConfig): Promise<string> {
  const { limits } = await orgPlan(member.org);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.agents).where(eq(schema.agents.orgId, member.org.id));
  if (count >= limits.agents) throw new Refused(`Your plan allows ${limits.agents} agents. Upgrade to add more.`, 402, { upgrade: true });
  const draft = from ? { ...from, name: `${from.name} copy` } : defaultAgentConfig();
  const [row] = await db.insert(schema.agents).values({ orgId: member.org.id, draft }).returning({ id: schema.agents.id });
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Agents", action: from ? "Duplicated an agent" : "Created an agent", item: draft.name });
  return row.id;
}

export async function duplicateAgent(member: MemberContext, agentId: string): Promise<string> {
  const agent = await ownAgent(member.org.id, agentId);
  return createAgent(member, agent.draft);
}

function changedKeys(before: AgentConfig, after: AgentConfig): (keyof AgentConfig)[] {
  return (Object.keys(after) as (keyof AgentConfig)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

const LABEL: Partial<Record<keyof AgentConfig, string>> = {
  instructions: "prompt edited",
  tone: "tone",
  model: "model",
  tools: "tools",
  excludedSources: "knowledge",
  escalation: "escalation",
  guardrails: "guardrails",
  blockedTopics: "blocked topics",
  allowedTopics: "allowed topics",
};

export async function saveDraft(member: MemberContext, agentId: string, input: unknown): Promise<void> {
  const config = agentConfigSchema.parse(input) as AgentConfig;
  await checkPlan(member, config);
  const agent = await ownAgent(member.org.id, agentId);
  const toolChanges = Object.entries(config.tools).filter(([k, t]) => JSON.stringify(agent.draft.tools[k]) !== JSON.stringify(t));
  await db.update(schema.agents).set({ draft: config, updatedAt: new Date() }).where(eq(schema.agents.id, agentId));
  for (const [key, tool] of toolChanges) {
    await audit({
      orgId: member.org.id,
      actorUserId: member.user.id,
      actorName: member.user.name,
      area: "Tools",
      action: tool.enabled ? "Changed a tool" : "Turned off a tool",
      item: `${config.name} · ${key}`,
      change: tool.policy ? `confirmation: ${tool.policy}` : tool.enabled ? "enabled" : "disabled",
    });
  }
}

/** AGT-002 FR-002, FR-004: the draft becomes version n+1 and goes live. */
export async function publish(member: MemberContext, agentId: string): Promise<number> {
  const agent = await ownAgent(member.org.id, agentId);
  await checkPlan(member, agent.draft);
  const [latest] = await db
    .select({ number: schema.agentVersions.number, config: schema.agentVersions.config })
    .from(schema.agentVersions)
    .where(eq(schema.agentVersions.agentId, agentId))
    .orderBy(desc(schema.agentVersions.number))
    .limit(1);
  const number = (latest?.number ?? 0) + 1;
  await db.transaction(async (tx) => {
    await tx.insert(schema.agentVersions).values({ orgId: member.org.id, agentId, number, config: agent.draft, publishedBy: member.user.id });
    await tx.update(schema.agents).set({ liveVersion: number }).where(eq(schema.agents.id, agentId));
    const changes = latest ? changedKeys(latest.config, agent.draft).map((k) => LABEL[k] ?? String(k)) : ["first version"];
    await audit(
      { orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Agents", action: `Published version ${number}`, item: agent.draft.name, change: changes.join(" · ") },
      tx,
    );
  });
  return number;
}

/** AGT-002 FR-003, FR-005: makes an earlier version live; the draft is kept. */
export async function rollBack(member: MemberContext, agentId: string, number: number): Promise<void> {
  const agent = await ownAgent(member.org.id, agentId);
  const version = await db.query.agentVersions.findFirst({ where: and(eq(schema.agentVersions.agentId, agentId), eq(schema.agentVersions.number, number)) });
  if (!version) throw new Refused("This version does not exist.", 404);
  await db.update(schema.agents).set({ liveVersion: number }).where(eq(schema.agents.id, agentId));
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Agents", action: `Rolled back to version ${number}`, item: agent.draft.name, change: `from version ${agent.liveVersion}` });
}

// ---------------------------------------------------------------- tools

export const httpToolSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1, "Describe what the tool does for the model.").max(500),
  access: z.enum(["read", "write"]),
  endpoint: z.string().url("Enter the full https:// address."),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: z.record(z.string(), z.string()).default({}),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object", properties: {} }),
  secrets: z.record(z.string(), z.string()).default({}),
});

export async function createHttpTool(member: MemberContext, input: unknown): Promise<string> {
  const { limits } = await orgPlan(member.org);
  if (!limits.httpTools) throw new Refused("HTTP tools need the Growth plan or above.", 402, { upgrade: true });
  const data = httpToolSchema.parse(input);
  const [row] = await db
    .insert(schema.httpTools)
    .values({
      orgId: member.org.id,
      name: data.name,
      description: data.description,
      access: data.access,
      config: { endpoint: data.endpoint, method: data.method, headers: data.headers, inputSchema: data.inputSchema },
      secrets: Object.keys(data.secrets).length ? sealText(JSON.stringify(data.secrets)) : null,
    })
    .returning({ id: schema.httpTools.id });
  await audit({ orgId: member.org.id, actorUserId: member.user.id, actorName: member.user.name, area: "Tools", action: "Added an HTTP tool", item: data.name, change: `${data.method} ${new URL(data.endpoint).host}${Object.keys(data.secrets).length ? " · secrets set, not shown" : ""}` });
  return row.id;
}

/** Tool definitions for the agent service, without secret values for the client. */
export async function toolCatalogue(orgId: string) {
  const http = await db.query.httpTools.findMany({ where: eq(schema.httpTools.orgId, orgId) });
  return [
    ...BUILTIN_TOOLS.map((t) => ({ key: t.key, name: t.name, description: t.description, access: t.access, kind: "builtin" as const })),
    ...http.map((t) => ({ key: `http_${t.id.replace(/-/g, "").slice(0, 16)}`, id: t.id, name: t.name, description: t.description, access: t.access, kind: "http" as const })),
  ];
}

/** The tools an agent version may call on a deployment, as agent-service specs with secrets. */
export async function toolSpecs(orgId: string, config: AgentConfig, subset: string[] | null): Promise<ToolSpec[]> {
  const http = await db.query.httpTools.findMany({ where: eq(schema.httpTools.orgId, orgId) });
  const specs: ToolSpec[] = [];
  for (const builtin of BUILTIN_TOOLS) {
    const setting = config.tools[builtin.key];
    if (!setting?.enabled || (subset && !subset.includes(builtin.key))) continue;
    if (builtin.key === "request_person" && !config.escalation.agentRequest) continue;
    specs.push({
      key: builtin.key,
      name: builtin.name,
      description: builtin.description,
      access: builtin.access,
      policy: builtin.access === "read" ? "read" : ((setting.policy ?? "staff_approval") as ToolPolicy),
      input_schema: builtin.schema,
      kind: "builtin",
    });
  }
  for (const tool of http) {
    const key = `http_${tool.id.replace(/-/g, "").slice(0, 16)}`;
    const setting = config.tools[key];
    if (!setting?.enabled || (subset && !subset.includes(key))) continue;
    specs.push({
      key,
      name: tool.name,
      description: tool.description,
      access: tool.access,
      policy: tool.access === "read" ? "read" : ((setting.policy ?? "staff_approval") as ToolPolicy),
      input_schema: tool.config.inputSchema,
      kind: "http",
      endpoint: tool.config.endpoint,
      method: tool.config.method,
      headers: tool.config.headers,
      secrets: tool.secrets ? (JSON.parse(openText(tool.secrets)) as Record<string, string>) : {},
    });
  }
  return specs;
}

/** The ready and enabled sources an agent may read: all of the organization's, less its exclusions. */
export async function readableSources(orgId: string, excluded: string[]) {
  const rows = await db
    .select({ id: schema.sources.id, name: schema.sources.name })
    .from(schema.sources)
    .where(and(eq(schema.sources.orgId, orgId), eq(schema.sources.enabled, true), eq(schema.sources.status, "ready")));
  return rows.filter((r) => !excluded.includes(r.id));
}

export function agentSpec(config: AgentConfig) {
  return {
    name: config.name,
    model: config.model,
    instructions: config.instructions,
    tone: config.tone,
    creativity: config.creativity,
    reply_length: config.replyLength,
    allowed_topics: config.allowedTopics,
    blocked_topics: config.blockedTopics,
    refusal_message: config.refusalMessage,
    disclose_ai: config.guardrails.discloseAi,
    say_unsure: config.guardrails.sayUnsure,
    agent_request: config.escalation.agentRequest,
  };
}

/**
 * AGT-003: one test turn with the draft as it is in the editor, saved or not; write tools are
 * proposed only and nothing is metered.
 */
export async function testTurn(member: MemberContext, agentId: string, transcript: TurnLine[], editing?: unknown): Promise<TurnResult> {
  const agent = await ownAgent(member.org.id, agentId);
  const config = editing ? (agentConfigSchema.parse(editing) as AgentConfig) : agent.draft;
  return runTurn({
    org_id: member.org.id,
    agent: agentSpec(config),
    transcript: transcript.slice(-20),
    language: config.replyLanguage,
    sources: await readableSources(member.org.id, config.excludedSources),
    tools: await toolSpecs(member.org.id, config, null),
    test: true,
  });
}
