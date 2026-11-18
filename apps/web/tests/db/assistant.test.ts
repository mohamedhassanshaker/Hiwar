import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * Handoff v2 section 1.10, the assistant panel's saved conversations, against the database.
 *
 * A saved chat is a person's own questions, so what is checked is that every read and write
 * reaches only the signed-in person's rows, that a save replaces the stored turns rather than
 * adding to them, and that the history keeps a fixed number of conversations.
 */

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("the assistant's saved conversations", () => {
  let ownerId = "";
  let memberId = "";
  let designerId = "";

  const personId = async (email: string) =>
    (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;

  const storedTurns = async (chatId: string) =>
    (
      await testPool().query<{ role: string; body_text: string }>(
        "select role, body_text from ai.assistant_chat_message where chat_id = $1 order by sort_order",
        [chatId],
      )
    ).rows.map((row) => ({ role: row.role, text: row.body_text }));

  beforeAll(async () => {
    ownerId = await personId("mariam@tahseel.ae");
    memberId = await personId("layla@tahseel.ae");
    designerId = await personId("omar@tahseel.ae");
  });

  afterEach(async () => {
    signedInAs = "";
    // Only the people these cases sign in as, and only their chats.
    await testPool().query("delete from ai.assistant_chat where person_id = any($1)", [[ownerId, memberId, designerId]]);
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("a first save stores the turns and titles the chat with the first question", async () => {
    const { saveChat } = await import("@/features/assistant/service");
    signedInAs = ownerId;
    const turns = [
      { role: "user" as const, text: "  How many requests are waiting for approval in the Finance project this week?  " },
      { role: "assistant" as const, text: "Four are waiting." },
    ];

    const chatId = await saveChat({ screen: "/dashboard", turns });

    const chat = await testPool().query<{ person_id: string; title: string; screen: string }>(
      "select person_id, title, screen from ai.assistant_chat where id = $1",
      [chatId],
    );
    // The first sixty characters of the trimmed question.
    expect(chat.rows[0]).toEqual({ person_id: ownerId, title: "How many requests are waiting for approval in the Finance pr", screen: "/dashboard" });
    expect(await storedTurns(chatId)).toEqual(turns);
  });

  it("saving again replaces the stored turns, and a chat with no question is a New chat", async () => {
    const { saveChat } = await import("@/features/assistant/service");
    signedInAs = ownerId;

    const chatId = await saveChat({ screen: "/inbox", turns: [{ role: "assistant", text: "Hello." }] });
    expect((await testPool().query<{ title: string }>("select title from ai.assistant_chat where id = $1", [chatId])).rows[0].title).toBe("New chat");

    const replaced = [
      { role: "user" as const, text: "What is open?" },
      { role: "assistant" as const, text: "Two items." },
    ];
    expect(await saveChat({ chatId, screen: "/inbox/2", turns: replaced })).toBe(chatId);
    expect(await storedTurns(chatId)).toEqual(replaced);
    const chat = await testPool().query<{ title: string; screen: string }>("select title, screen from ai.assistant_chat where id = $1", [chatId]);
    expect(chat.rows[0]).toEqual({ title: "What is open?", screen: "/inbox/2" });
  });

  it("D239 a name given to a chat stays when the chat is saved again, and only its owner can give one", async () => {
    const { renameChat, saveChat } = await import("@/features/assistant/service");
    signedInAs = ownerId;
    const turns = [{ role: "user" as const, text: "What is open?" }];
    const chatId = await saveChat({ screen: "/inbox", turns });

    expect(await renameChat(chatId, "Open items")).toBe(true);
    await saveChat({ chatId, screen: "/inbox", turns: [...turns, { role: "assistant", text: "Two items." }] });
    const title = async () => (await testPool().query<{ title: string }>("select title from ai.assistant_chat where id = $1", [chatId])).rows[0].title;
    expect(await title()).toBe("Open items");

    signedInAs = memberId;
    expect(await renameChat(chatId, "Mine now")).toBe(false);
    expect(await title()).toBe("Open items");
  });

  it("a person lists, reopens and deletes only their own chats", async () => {
    const { deleteChat, listChats, readChat, saveChat } = await import("@/features/assistant/service");
    signedInAs = ownerId;
    const turns = [
      { role: "user" as const, text: "Summarise this page" },
      { role: "assistant" as const, text: "It lists the agents." },
    ];
    const chatId = await saveChat({ screen: "/agents", turns });

    const listed = await listChats();
    expect(listed.map((chat) => [chat.id, chat.title, chat.screen, chat.messageCount])).toEqual([[chatId, "Summarise this page", "/agents", 2]]);
    expect(await readChat(chatId)).toMatchObject({ id: chatId, messageCount: 2, turns });

    // Somebody else sees nothing of it, cannot reopen it and cannot delete it.
    signedInAs = memberId;
    expect(await listChats()).toEqual([]);
    expect(await readChat(chatId)).toBeNull();
    expect(await deleteChat(chatId)).toBe(false);
    expect((await testPool().query("select 1 from ai.assistant_chat where id = $1", [chatId])).rowCount).toBe(1);

    // Saving onto somebody else's chat id starts a chat of their own instead.
    const own = await saveChat({ chatId, screen: "/inbox", turns: [{ role: "user", text: "Mine" }] });
    expect(own).not.toBe(chatId);
    expect(await storedTurns(chatId)).toEqual(turns);

    signedInAs = ownerId;
    expect(await deleteChat(chatId)).toBe(true);
    expect((await testPool().query("select 1 from ai.assistant_chat where id = $1", [chatId])).rowCount).toBe(0);
  });

  it("the history keeps the thirty latest conversations of a person", async () => {
    const { saveChat } = await import("@/features/assistant/service");
    signedInAs = designerId;
    const before = await testPool().query("select 1 from ai.assistant_chat where person_id = $1", [designerId]);
    expect(before.rowCount, "the case must start from a person with no saved chats").toBe(0);

    const saved: string[] = [];
    for (let index = 0; index < 31; index += 1) {
      saved.push(await saveChat({ screen: "/dashboard", turns: [{ role: "user", text: `Question ${index}` }] }));
    }

    const kept = await testPool().query<{ id: string }>("select id from ai.assistant_chat where person_id = $1", [designerId]);
    expect(kept.rows.map((row) => row.id).sort()).toEqual(saved.slice(1).sort());
  });

  it("COM-09 without a session nothing is read or written, and the person is sent to sign in", async () => {
    const { deleteChat, listChats, readChat, saveChat } = await import("@/features/assistant/service");
    const chatId = crypto.randomUUID();

    await expect(listChats()).rejects.toThrow(/^redirect:\/sign-in/);
    await expect(readChat(chatId)).rejects.toThrow(/^redirect:\/sign-in/);
    await expect(saveChat({ screen: "/dashboard", turns: [{ role: "user", text: "Hello" }] })).rejects.toThrow(/^redirect:\/sign-in/);
    await expect(deleteChat(chatId)).rejects.toThrow(/^redirect:\/sign-in/);
  });
});
