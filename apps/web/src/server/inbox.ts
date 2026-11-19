import { and, asc, eq, sql } from "drizzle-orm";

import { db, schema, type Tx } from "@/db";
import type { AgentConfig, MessageMeta } from "@/db/schema";
import { Refused } from "./api";
import { audit } from "./audit";
import { can } from "./authz";
import { publish } from "./live";
import { notify, resolveNotices } from "./notifications";
import type { MemberContext } from "./session";

/**
 * The single-owner state machine of INB-002. Every ownership change is one UPDATE guarded by
 * the version the caller saw; zero rows means another change won (first valid claim wins).
 */

export type State = (typeof schema.conversationStateEnum.enumValues)[number];
type Conversation = typeof schema.conversations.$inferSelect;

export const STATE_LABEL: Record<State, string> = {
  AI_ACTIVE: "With the AI",
  HANDOVER_PENDING: "Waiting for a person",
  HUMAN_ACTIVE: "With {name}",
  CLOSED: "Closed",
};

export const REASON_TEXT: Record<string, string> = {
  visitor_request: "Visitor asked for a person",
  agent_request: "Agent asked for a person",
  low_confidence: "Repeated low confidence",
  negative_sentiment: "Negative sentiment",
  sensitive_topic: "Sensitive topic",
  tool_failure: "Repeated tool failure",
  tool_approval: "Write tool needs approval",
  other: "Other",
};

export async function loadConversation(orgId: string, id: string): Promise<Conversation> {
  const row = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.id, id), eq(schema.conversations.orgId, orgId)) });
  if (!row) throw new Refused("This conversation does not exist.", 404);
  return row;
}

export async function addMessage(
  tx: Tx | typeof db,
  c: Pick<Conversation, "id" | "orgId">,
  kind: (typeof schema.messageKindEnum.enumValues)[number],
  text: string,
  extra: { authorUserId?: string | null; authorName?: string | null; meta?: MessageMeta } = {},
) {
  const [row] = await tx
    .insert(schema.messages)
    .values({ orgId: c.orgId, conversationId: c.id, kind, text, authorUserId: extra.authorUserId ?? null, authorName: extra.authorName ?? null, meta: extra.meta ?? {} })
    .returning();
  await tx
    .update(schema.conversations)
    .set({ lastMessageAt: new Date(), ...(kind === "visitor" ? { lastVisitorAt: new Date() } : {}) })
    .where(eq(schema.conversations.id, c.id));
  return row;
}

async function event(tx: Tx, c: Pick<Conversation, "id" | "orgId">, version: number, text: string, actor: string, reasonCode: string, note?: string) {
  await tx.insert(schema.ownershipEvents).values({ orgId: c.orgId, conversationId: c.id, event: text, actor, reasonCode, version, note: note ?? null });
}

export async function announce(c: Pick<Conversation, "id" | "orgId">): Promise<void> {
  await publish(`conv:${c.id}`, { type: "conversation" });
  await publish(`org:${c.orgId}`, { type: "conversations" });
}

/** One guarded ownership change. Returns the new row, or null when the version moved. */
async function change(
  tx: Tx,
  c: Conversation,
  set: Partial<typeof schema.conversations.$inferInsert>,
  allowedFrom: State[],
): Promise<Conversation | null> {
  const [row] = await tx
    .update(schema.conversations)
    .set({ ...set, version: sql`${schema.conversations.version} + 1` })
    .where(
      and(
        eq(schema.conversations.id, c.id),
        eq(schema.conversations.version, c.version),
        sql`${schema.conversations.state} = ANY(${`{${allowedFrom.join(",")}}`}::conversation_state[])`,
      ),
    )
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------- staff actions

/** FR-003, FR-004, FR-020: take over from the AI, or (Owner and Admin) from another person. */
export async function takeOver(member: MemberContext, id: string, seenVersion: number): Promise<void> {
  const c = await loadConversation(member.org.id, id);
  if (c.version !== seenVersion) throw new Refused("The conversation changed. Look again before taking over.", 409);
  const fromPerson = c.state === "HUMAN_ACTIVE" && c.ownerUserId !== member.user.id;
  if (c.state !== "AI_ACTIVE" && !fromPerson) throw new Refused("Take over is available while the AI owns the conversation.", 409);
  if (fromPerson && !can(member.role, "supervisor_takeover")) throw new Refused("Only an Owner or Admin can take over from a colleague.", 403);
  const previousOwner = fromPerson && c.ownerUserId ? await db.query.users.findFirst({ where: eq(schema.users.id, c.ownerUserId) }) : null;
  const reason = fromPerson ? "supervisor_takeover" : "support_takeover";
  await db.transaction(async (tx) => {
    const row = await change(tx, c, { state: "HUMAN_ACTIVE", ownerUserId: member.user.id, reasonCode: reason, waitingSince: null, handedOver: true }, [c.state]);
    if (!row) throw new Refused("Someone else changed this conversation a moment earlier.", 409);
    const text = fromPerson
      ? `${member.user.name} took over from ${previousOwner?.name ?? "a colleague"}. The visitor sees "A team member has joined".`
      : `${member.user.name} took over. The AI reply in progress was cancelled and the unsent text was discarded. The visitor sees "A team member has joined".`;
    await addMessage(tx, c, "event", text);
    await event(tx, c, row.version, `${member.user.name} took over`, member.user.name, reason);
    await audit({ orgId: c.orgId, actorUserId: member.user.id, actorName: member.user.name, area: "Conversations", action: fromPerson ? "Supervisor take over" : "Took over", item: c.visitor.name ?? "Visitor", change: `owner ${fromPerson ? previousOwner?.name : "AI"} to ${member.user.name} · v${row.version}` }, tx);
  });
  cancelGeneration(c.id);
  if (fromPerson && previousOwner) {
    await db.insert(schema.notifications).values({ orgId: c.orgId, userId: previousOwner.id, kind: "taken_over", title: `${member.user.name} took over this conversation`, link: `/conversations?c=${c.id}` });
  }
  await announce(c);
}

/** FR-005 to FR-007, FR-031: the first valid claim wins. */
export async function claim(member: MemberContext, id: string): Promise<void> {
  const c = await loadConversation(member.org.id, id);
  if (c.state !== "HANDOVER_PENDING") {
    const owner = c.ownerUserId ? await db.query.users.findFirst({ where: eq(schema.users.id, c.ownerUserId) }) : null;
    throw new Refused(owner ? `${owner.name} claimed this conversation a moment earlier. Only one claim succeeds.` : "This conversation is no longer waiting for a person.", 409);
  }
  await db.transaction(async (tx) => {
    const row = await change(tx, c, { state: "HUMAN_ACTIVE", ownerUserId: member.user.id, waitingSince: null, handedOver: true }, ["HANDOVER_PENDING"]);
    if (!row) {
      const fresh = await tx.query.conversations.findFirst({ where: eq(schema.conversations.id, c.id) });
      const owner = fresh?.ownerUserId ? await tx.query.users.findFirst({ where: eq(schema.users.id, fresh.ownerUserId) }) : null;
      throw new Refused(`${owner?.name ?? "A colleague"} claimed this conversation a moment earlier. Only one claim succeeds.`, 409);
    }
    await addMessage(tx, c, "event", `${member.user.name} claimed this conversation. The visitor sees "A team member has joined".`);
    await event(tx, c, row.version, `${member.user.name} claimed it`, member.user.name, "first valid claim");
    await audit({ orgId: c.orgId, actorUserId: member.user.id, actorName: member.user.name, area: "Conversations", action: "Claimed", item: c.visitor.name ?? "Visitor", change: `v${row.version}` }, tx);
    await resolveNotices(c.orgId, c.id, tx);
  });
  await announce(c);
}

async function requireOwner(member: MemberContext, id: string): Promise<Conversation> {
  const c = await loadConversation(member.org.id, id);
  if (c.state !== "HUMAN_ACTIVE" || c.ownerUserId !== member.user.id) throw new Refused("Only the owner can do this.", 403);
  return c;
}

/** FR-008 to FR-010, FR-023, FR-024: hand back with a staff-only note or a written summary. */
export async function handBack(member: MemberContext, id: string, note: string, tellVisitor: boolean): Promise<void> {
  const c = await requireOwner(member, id);
  const text = note.trim() || (await summarize(c.id, member.user.id));
  await db.transaction(async (tx) => {
    const row = await change(tx, c, { state: "AI_ACTIVE", ownerUserId: null, reasonCode: "handback", tellVisitorBack: tellVisitor }, ["HUMAN_ACTIVE"]);
    if (!row) throw new Refused("The conversation changed. Look again.", 409);
    await addMessage(tx, c, "event", `Handed back to the AI with a staff note: "${text}". The visitor does not see the note.`, { meta: { reasonCode: "handback_note" } });
    await event(tx, c, row.version, "Handed back to the AI", member.user.name, "handback with note", text);
    await audit({ orgId: c.orgId, actorUserId: member.user.id, actorName: member.user.name, area: "Conversations", action: "Handed back", item: c.visitor.name ?? "Visitor", change: `v${row.version}` }, tx);
  });
  await announce(c);
}

/** A summary written from the staff member's part of the conversation (FR-009, FR-023). */
async function summarize(conversationId: string, userId: string): Promise<string> {
  const mine = await db
    .select({ text: schema.messages.text })
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.authorUserId, userId), eq(schema.messages.kind, "staff")))
    .orderBy(asc(schema.messages.createdAt));
  if (mine.length === 0) return "Summary written by Hiwar: a person took the conversation and handed it back without replying.";
  const last = mine.slice(-3).map((m) => m.text.replace(/\s+/g, " ").slice(0, 160));
  return `Summary written by Hiwar: the person replied ${mine.length} time${mine.length > 1 ? "s" : ""}. Last replies: ${last.join(" / ")}`;
}

/** FR-011, FR-026: back to the queue with no owner. */
export async function release(member: MemberContext, id: string): Promise<void> {
  const c = await requireOwner(member, id);
  await db.transaction(async (tx) => {
    const row = await change(tx, c, { state: "HANDOVER_PENDING", ownerUserId: null, reasonCode: "released", waitingSince: new Date(), followUpOffered: false }, ["HUMAN_ACTIVE"]);
    if (!row) throw new Refused("The conversation changed. Look again.", 409);
    await addMessage(tx, c, "event", "Released to the queue without handing back. Waiting for a person.");
    await event(tx, c, row.version, `${member.user.name} released it`, member.user.name, "released", `Released by ${member.user.name}`);
    await notify(c.orgId, "waiting", `${c.visitor.name ?? "A visitor"} is waiting for a person (released by ${member.user.name})`, `/conversations?c=${c.id}`, c.id, tx);
  });
  await announce(c);
}

/** FR-012, FR-027: closes any open conversation, with a summary and a feedback request. */
export async function close(c: Conversation, by: "staff" | "visitor" | "auto", actor: { userId: string | null; name: string }): Promise<boolean> {
  if (c.state === "CLOSED") return false;
  const ok = await db.transaction(async (tx) => {
    const row = await change(tx, c, { state: "CLOSED", ownerUserId: null, closedAt: new Date(), closedBy: by, waitingSince: null, summary: actor.userId ? await summarize(c.id, actor.userId) : "Closed by Hiwar after a quiet period without a staff reply." }, [c.state]);
    if (!row) return false;
    const text = by === "auto" ? "Closed after 30 minutes without a visitor message. A summary was created." : "Conversation closed. A summary was created and the visitor was asked for feedback.";
    await addMessage(tx, c, "event", text);
    await event(tx, c, row.version, by === "staff" ? `Closed by ${actor.name}` : by === "auto" ? "Closed after a quiet period" : "Closed by the visitor", actor.name, `${by} closed`);
    await resolveNotices(c.orgId, c.id, tx);
    return true;
  });
  if (ok) {
    cancelGeneration(c.id);
    await announce(c);
  }
  return ok;
}

export async function closeByStaff(member: MemberContext, id: string): Promise<void> {
  const c = await loadConversation(member.org.id, id);
  if (c.state === "CLOSED") throw new Refused("This conversation is already closed.", 409);
  if (!(await close(c, "staff", { userId: member.user.id, name: member.user.name }))) throw new Refused("The conversation changed. Look again.", 409);
}

/** FR-013 to FR-016, FR-022, FR-028: a reply (owner only, current version) or an internal note. */
export async function staffMessage(member: MemberContext, id: string, mode: "reply" | "note", text: string, seenVersion: number): Promise<void> {
  const body = text.trim();
  if (!body) throw new Refused("Write a message first.");
  const c = await loadConversation(member.org.id, id);
  if (c.state === "CLOSED") throw new Refused("This conversation is closed.", 409);
  if (mode === "note") {
    await addMessage(db, c, "note", body, { authorUserId: member.user.id, authorName: member.user.name });
    await announce(c);
    return;
  }
  if (c.state !== "HUMAN_ACTIVE" || c.ownerUserId !== member.user.id) throw new Refused("Only the owner can reply. Take over to reply.", 403);
  if (c.version !== seenVersion) throw new Refused("The conversation changed while you were writing. Your reply was not sent.", 409);
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.conversations).where(eq(schema.conversations.id, c.id)).for("update");
    if (locked.version !== seenVersion || locked.ownerUserId !== member.user.id) throw new Refused("The conversation changed while you were writing. Your reply was not sent.", 409);
    await addMessage(tx, c, "staff", body, { authorUserId: member.user.id, authorName: member.user.name });
  });
  await announce(c);
}

// ---------------------------------------------------------------- AI generation in progress

const state = globalThis as unknown as { hiwarGenerations?: Map<string, AbortController> };
state.hiwarGenerations ??= new Map();
export const generations = state.hiwarGenerations;

/** Take over cancels the AI generation in progress (FR-004); the version check discards its result anyway. */
export function cancelGeneration(conversationId: string): void {
  generations.get(conversationId)?.abort();
  generations.delete(conversationId);
}

/** Whether the AI is writing in this conversation now (the typing indicator, INB-001 FR-009). */
export function isGenerating(conversationId: string): boolean {
  return generations.has(conversationId);
}

export function welcomeOf(config: AgentConfig, language: "en" | "ar"): string {
  return config.welcome[language] || config.welcome.en;
}
