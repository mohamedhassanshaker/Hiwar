import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import type { Visitor } from "@/db/schema";
import { runTool, type ToolSpec } from "./agent-service";
import { toolSpecs } from "./agents";
import { Refused } from "./api";
import { addMessage, announce, isGenerating } from "./inbox";
import { notify } from "./notifications";
import { currentConversation, deploymentByKey, sendTranscript, servedVersion, withinHours } from "./visitor";

/** What the visitor's widget shows (DEP-003). Staff-only notes, events and tool details never leave the server. */

export type WidgetLine =
  | { kind: "visitor" | "ai"; text: string; at: string; citations?: string[] }
  | { kind: "person"; text: string; name: string; at: string }
  | { kind: "status"; status: "waiting" | "joined" | "left" | "cancelled" | "reopened"; at: string }
  | { kind: "notice"; text: string; at: string };

/** Record a widget frame the browser will not show (OPS-004 FR-003). A failed write is logged, never shown to the visitor. */
export async function recordWidgetLoadError(row: { orgId: string | null; deploymentId: string | null; reason: "unknown_key" | "origin_not_allowed"; origin: string | null }): Promise<void> {
  try {
    await db.insert(schema.widgetLoadErrors).values(row);
  } catch (problem) {
    console.error("widget load error not recorded", problem);
  }
}

export async function widgetContext(key: string) {
  const deployment = await deploymentByKey(key);
  if (!deployment) throw new Refused("Unknown widget key.", 404);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, deployment.orgId) });
  const served = await servedVersion(deployment);
  return { deployment, org, served };
}

export async function widgetState(key: string, token: string) {
  const { deployment, org, served } = await widgetContext(key);
  const settings = deployment.settings;
  const config = served?.config ?? null;
  const offline =
    deployment.status !== "live" || !served || !org || org.status === "suspended" || org.status === "trial_ended";
  const base = {
    status: deployment.status,
    offline,
    outsideHours: config ? !withinHours(config) : false,
    agentName: config?.name ?? "Assistant",
    welcome: { en: settings.welcome.en || config?.welcome.en || "Hi! How can I help you today?", ar: settings.welcome.ar || config?.welcome.ar || "مرحبًا! كيف أقدر أساعدك؟" },
    appearance: {
      brandColour: settings.brandColour,
      position: settings.position,
      showAiLabel: settings.showAiLabel && (config?.guardrails.discloseAi ?? true),
      suggestions: settings.suggestedQuestions ? settings.suggestions : { en: [], ar: [] },
      rtl: settings.rtl,
      preChatForm: settings.preChatForm,
      talkToPerson: config?.escalation.talkToPerson ?? true,
      citations: config?.guardrails.citations ?? false,
      languageOverride: settings.languageOverride,
    },
    offlineMessage: settings.offlineMessage,
  };
  const c = token ? await currentConversation(deployment, token) : null;
  if (!c) return { ...base, conversation: null };

  const messages = await db.query.messages.findMany({ where: eq(schema.messages.conversationId, c.id), orderBy: asc(schema.messages.createdAt) });
  const events = await db.query.ownershipEvents.findMany({ where: eq(schema.ownershipEvents.conversationId, c.id), orderBy: asc(schema.ownershipEvents.createdAt) });
  const lines: WidgetLine[] = [];
  for (const m of messages) {
    if (m.kind === "visitor" || m.kind === "ai") {
      lines.push({ kind: m.kind, text: m.text, at: m.createdAt.toISOString(), citations: base.appearance.citations ? (m.meta.citations ?? []).map((x) => x.name) : undefined });
    } else if (m.kind === "staff") {
      lines.push({ kind: "person", text: m.text, name: (m.authorName ?? "Team").split(" ")[0], at: m.createdAt.toISOString() });
    } else if (m.kind === "event" && m.meta.visitorNotice) {
      lines.push({ kind: "notice", text: m.meta.visitorNotice, at: m.createdAt.toISOString() });
    }
  }
  for (const e of events) {
    const at = e.createdAt.toISOString();
    if (e.event === "Handover requested") lines.push({ kind: "status", status: "waiting", at });
    else if (/took over|claimed it/.test(e.event)) lines.push({ kind: "status", status: "joined", at });
    else if (e.event === "Handed back to the AI" && c.tellVisitorBack) lines.push({ kind: "status", status: "left", at });
    else if (e.reasonCode === "visitor_cancelled") lines.push({ kind: "status", status: "cancelled", at });
  }
  lines.sort((a, b) => a.at.localeCompare(b.at));
  const owner = c.ownerUserId ? await db.query.users.findFirst({ where: eq(schema.users.id, c.ownerUserId) }) : null;
  const pendingTool = await db.query.toolCalls.findFirst({
    where: and(eq(schema.toolCalls.conversationId, c.id), eq(schema.toolCalls.status, "waiting_visitor")),
  });
  return {
    ...base,
    conversation: {
      state: c.state,
      lines,
      ownerName: owner ? owner.name.split(" ")[0] : null,
      typing: isGenerating(c.id),
      followUp: c.followUpOffered && c.state === "HANDOVER_PENDING",
      askFeedback: c.state === "CLOSED" && !c.feedback && c.closedBy !== "visitor",
      contactGiven: Boolean(c.visitor.email || c.visitor.phone),
      pendingTool: pendingTool ? { id: pendingTool.id, name: pendingTool.toolName, inputs: pendingTool.inputs } : null,
    },
  };
}

/** D-010, DEP-003 FR-007, FR-019: contact details for follow-up or the offline message. */
export async function saveContact(key: string, token: string, contact: { name?: string; email?: string; phone?: string; message?: string }, language: "en" | "ar") {
  const { deployment } = await widgetContext(key);
  let c = await currentConversation(deployment, token);
  if (!c) {
    const [row] = await db
      .insert(schema.conversations)
      .values({
        orgId: deployment.orgId,
        deploymentId: deployment.id,
        agentId: deployment.agentId,
        agentVersion: (await servedVersion(deployment))?.number ?? 0,
        visitorToken: token,
        visitor: { language },
        state: "HANDOVER_PENDING",
        reasonCode: "offline_message",
        waitingSince: new Date(),
        followUpOffered: true,
      })
      .returning();
    c = row;
  }
  const visitor: Visitor = { ...c.visitor, name: contact.name || c.visitor.name, email: contact.email || c.visitor.email, phone: contact.phone || c.visitor.phone, contactMessage: contact.message };
  await db.update(schema.conversations).set({ visitor }).where(eq(schema.conversations.id, c.id));
  if (contact.message) await addMessage(db, c, "visitor", contact.message);
  await addMessage(db, c, "event", `The visitor left contact details for follow-up: ${[contact.name, contact.email, contact.phone].filter(Boolean).join(" · ")}`);
  await notify(c.orgId, "waiting", `${visitor.name ?? "A visitor"} left contact details for follow-up`, `/conversations?c=${c.id}`, c.id);
  await announce(c);
}

export async function saveFeedback(key: string, token: string, answer: "yes" | "no") {
  const { deployment } = await widgetContext(key);
  const c = await currentConversation(deployment, token);
  if (!c || c.state !== "CLOSED") return;
  await db.update(schema.conversations).set({ feedback: answer }).where(eq(schema.conversations.id, c.id));
  await addMessage(db, c, "event", `The visitor answered "Was this helpful?": ${answer === "yes" ? "Yes" : "No"}.`);
  await announce(c);
}

/** INB-003 FR-008: "Ask the visitor first" — the tool runs only after Confirm. */
export async function confirmTool(key: string, token: string, toolCallId: string, confirm: boolean) {
  const { deployment, served } = await widgetContext(key);
  const c = await currentConversation(deployment, token);
  if (!c || !served) throw new Refused("No conversation.", 404);
  const call = await db.query.toolCalls.findFirst({ where: and(eq(schema.toolCalls.id, toolCallId), eq(schema.toolCalls.conversationId, c.id), eq(schema.toolCalls.status, "waiting_visitor")) });
  if (!call) throw new Refused("This action is no longer waiting.", 409);
  const lang = c.visitor.language;
  if (!confirm) {
    await db.update(schema.toolCalls).set({ status: "cancelled", reason: "The visitor cancelled", decidedAt: new Date() }).where(eq(schema.toolCalls.id, call.id));
    await addMessage(db, c, "ai", lang === "ar" ? "تمام، لم أقم بذلك." : "OK, I did not do that.");
  } else {
    const specs = await toolSpecs(c.orgId, served.config, deployment.settings.toolSubset);
    const spec = specs.find((s) => s.key === call.toolKey);
    const outcome = spec ? await executeTool(spec, call.inputs) : { ok: false, result: { error: "The tool is no longer available" }, duration_ms: 0 };
    await db
      .update(schema.toolCalls)
      .set({ status: outcome.ok ? "ran" : "failed", result: outcome.result as object, durationMs: outcome.duration_ms, decidedAt: new Date(), reason: "Confirmed by the visitor" })
      .where(eq(schema.toolCalls.id, call.id));
    if (outcome.ok && call.toolKey === "send_transcript") await sendTranscript(c, String(call.inputs.email ?? ""));
    await addMessage(db, c, "ai", outcome.ok ? (lang === "ar" ? `تم: ${call.toolName}.` : `Done: ${call.toolName}.`) : lang === "ar" ? "تعذّر تنفيذ ذلك. سأحوّلك إلى أحد أفراد الفريق إذا رغبت." : "That did not work. I can connect you to a person if you like.");
  }
  await announce(c);
}

/** Runs a tool once: built-in write tools in the web application, HTTP tools in the agent service. */
export async function executeTool(spec: ToolSpec, inputs: Record<string, unknown>): Promise<{ ok: boolean; result: unknown; duration_ms: number }> {
  if (spec.kind === "builtin") return { ok: true, result: { queued: true }, duration_ms: 0 };
  return runTool(spec, inputs);
}
