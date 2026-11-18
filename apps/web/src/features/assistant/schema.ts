import { z } from "zod";

/** What the assistant panel may send when it saves or reopens a conversation. */

/** A turn longer than this is not a question; the panel never produces one. */
const TURN = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(20_000) });

export const saveChatInput = z.object({
  /** Absent for the first save of a new conversation. */
  chatId: z.uuid().optional(),
  screen: z.string().trim().min(1).max(200),
  turns: z.array(TURN).min(1).max(200),
});

export const chatIdInput = z.object({ chatId: z.uuid() });

export const renameChatInput = z.object({ chatId: z.uuid(), title: z.string().trim().min(1).max(120) });

/** A file attached to a question: the upload's own limit applies once it is decoded. */
export const attachmentInput = z.object({ name: z.string().trim().min(1).max(255), dataUrl: z.string().min(1) });

export type SaveChatInput = z.infer<typeof saveChatInput>;
export type ChatIdInput = z.infer<typeof chatIdInput>;
