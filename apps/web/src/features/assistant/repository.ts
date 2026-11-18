import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db, dbRo, schema as s } from "@/db/client";
import { outer } from "@/db/outer";
import type { ChatTurn, SavedChat, SavedChatDetail } from "./types";

/** The only module in `assistant` that touches Drizzle. */

/** How many conversations one person keeps. Older ones are dropped as new ones are saved. */
export const KEPT_PER_PERSON = 30;

/** The title of a conversation saved before anything was asked in it. */
export const NEW_CHAT_TITLE = "New chat";

/** A person's chats, most recent message first, at most `KEPT_PER_PERSON`, each with its turn count. */
export async function listChats(personId: string): Promise<SavedChat[]> {
  const rows = await dbRo()
    .select({
      id: s.assistantChat.id,
      title: s.assistantChat.title,
      screen: s.assistantChat.screen,
      lastMessageAt: s.assistantChat.lastMessageAt,
      messageCount: sql<number>`(select count(*) from ai.assistant_chat_message m where m.chat_id = ${outer(s.assistantChat.id)})::int`,
    })
    .from(s.assistantChat)
    .where(eq(s.assistantChat.personId, personId))
    .orderBy(desc(s.assistantChat.lastMessageAt))
    .limit(KEPT_PER_PERSON);
  return rows.map((row) => ({ ...row, lastMessageAt: row.lastMessageAt.toISOString() }));
}

/** One conversation with its turns — `null` when it is not this person's. */
export async function readChat(personId: string, chatId: string): Promise<SavedChatDetail | null> {
  const [chat] = await dbRo()
    .select({
      id: s.assistantChat.id,
      title: s.assistantChat.title,
      screen: s.assistantChat.screen,
      lastMessageAt: s.assistantChat.lastMessageAt,
    })
    .from(s.assistantChat)
    .where(and(eq(s.assistantChat.id, chatId), eq(s.assistantChat.personId, personId)))
    .limit(1);
  if (!chat) return null;

  const turns = await dbRo()
    .select({ role: s.assistantChatMessage.role, text: s.assistantChatMessage.bodyText })
    .from(s.assistantChatMessage)
    .where(eq(s.assistantChatMessage.chatId, chatId))
    .orderBy(asc(s.assistantChatMessage.sortOrder));

  return {
    ...chat,
    lastMessageAt: chat.lastMessageAt.toISOString(),
    messageCount: turns.length,
    turns: turns.map((turn) => ({ role: turn.role as ChatTurn["role"], text: turn.text })),
  };
}

/**
 * Write the whole conversation, creating it the first time.
 *
 * The turns are replaced rather than appended to. The panel holds the conversation while
 * it is open and saves after every answer, so "what is stored" and "what is on screen"
 * are the same list; appending would have to reason about which turns were already saved,
 * and a dropped delta would leave a conversation that reads as if a turn never happened.
 */
export async function saveChat(
  personId: string,
  chatId: string | null,
  title: string,
  screen: string,
  turns: ChatTurn[],
): Promise<string> {
  return db().transaction(async (tx) => {
    let id = chatId;
    if (id) {
      const [owned] = await tx
        .update(s.assistantChat)
        // A title somebody set stays (D239); a "New chat" takes the first question once asked.
        .set({
          title: sql`case when ${s.assistantChat.title} = ${NEW_CHAT_TITLE} then ${title} else ${s.assistantChat.title} end`,
          screen,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
          updatedBy: personId,
        })
        .where(and(eq(s.assistantChat.id, id), eq(s.assistantChat.personId, personId)))
        .returning({ id: s.assistantChat.id });
      // Gone, or never theirs: saving again starts a new one rather than failing the turn.
      id = owned?.id ?? null;
    }
    if (!id) {
      const [created] = await tx
        .insert(s.assistantChat)
        .values({ personId, title, screen, createdBy: personId, updatedBy: personId })
        .returning({ id: s.assistantChat.id });
      id = created.id;
    }

    await tx.delete(s.assistantChatMessage).where(eq(s.assistantChatMessage.chatId, id));
    if (turns.length > 0) {
      await tx.insert(s.assistantChatMessage).values(
        turns.map((turn, index) => ({
          chatId: id as string,
          sortOrder: index,
          role: turn.role,
          bodyText: turn.text,
          createdBy: personId,
          updatedBy: personId,
        })),
      );
    }

    // Keep the latest `KEPT_PER_PERSON`; the messages of the rest go with them.
    const stale = await tx
      .select({ id: s.assistantChat.id })
      .from(s.assistantChat)
      .where(eq(s.assistantChat.personId, personId))
      .orderBy(desc(s.assistantChat.lastMessageAt))
      .offset(KEPT_PER_PERSON);
    if (stale.length > 0) {
      await tx.delete(s.assistantChat).where(
        inArray(
          s.assistantChat.id,
          stale.map((row) => row.id),
        ),
      );
    }
    return id;
  });
}

/** Names one of this person's conversations; whether it was theirs to name. */
export async function renameChat(personId: string, chatId: string, title: string): Promise<boolean> {
  const renamed = await db()
    .update(s.assistantChat)
    .set({ title, updatedAt: new Date(), updatedBy: personId })
    .where(and(eq(s.assistantChat.id, chatId), eq(s.assistantChat.personId, personId)))
    .returning({ id: s.assistantChat.id });
  return renamed.length > 0;
}

/** Whether a conversation of this person's was there to delete. */
export async function deleteChat(personId: string, chatId: string): Promise<boolean> {
  const rows = await db()
    .delete(s.assistantChat)
    .where(and(eq(s.assistantChat.id, chatId), eq(s.assistantChat.personId, personId)))
    .returning({ id: s.assistantChat.id });
  return rows.length > 0;
}
