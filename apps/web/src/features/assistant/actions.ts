"use server";

import { attachmentInput, chatIdInput, renameChatInput, saveChatInput } from "./schema";
import * as service from "./service";
import type { SavedChat, SavedChatDetail } from "./types";

/** What the assistant panel calls to keep its history (handoff v2 section 1.10). */

export async function listSavedChats(): Promise<SavedChat[]> {
  return service.listChats();
}

/** One of the signed-in person's saved chats with its turns, or null when it is not theirs. */
export async function readSavedChat(input: unknown): Promise<SavedChatDetail | null> {
  return service.readChat(chatIdInput.parse(input).chatId);
}

/** Save the whole conversation through `service.saveChat` and return its id, new on a first save. */
export async function saveChat(input: unknown): Promise<string> {
  return service.saveChat(saveChatInput.parse(input));
}

/** D239: rename one of the person's saved chats. False when no chat of theirs has that id. */
export async function renameSavedChat(input: unknown): Promise<boolean> {
  const { chatId, title } = renameChatInput.parse(input);
  return service.renameChat(chatId, title);
}

/**
 * D239: the text of a file attached in the panel, through `service.readAttachment`: the text,
 * whether it was cut and whether the file store would keep it, or the refusal in both languages.
 */
export async function readAttachment(
  input: unknown,
): Promise<
  { ok: true; text: string; truncated: boolean; storable: boolean } | { ok: false; reason: string; reasonAr: string }
> {
  const { name, dataUrl } = attachmentInput.parse(input);
  return service.readAttachment(name, dataUrl);
}

/** Delete one of the person's saved chats. False when no chat of theirs has that id. */
export async function deleteSavedChat(input: unknown): Promise<boolean> {
  return service.deleteChat(chatIdInput.parse(input).chatId);
}
