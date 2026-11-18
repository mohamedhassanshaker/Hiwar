/** The assistant panel's saved conversations (handoff v2 section 1.10). */

/** One turn, as the panel draws it. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

/** One saved conversation in the history list. */
export type SavedChat = {
  id: string;
  title: string;
  screen: string;
  /** ISO-8601, so the browser formats it in the reader's own language. */
  lastMessageAt: string;
  messageCount: number;
};

/** A saved conversation with its turns, as reopening it needs. */
export type SavedChatDetail = SavedChat & { turns: ChatTurn[] };
