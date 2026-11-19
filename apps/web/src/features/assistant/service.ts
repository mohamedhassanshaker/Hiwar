import { extractDocumentText } from "@/lib/documents";
import { requireSession } from "@/lib/session";
import { bytesOfDataUrl, uploadRefusal } from "@/lib/uploads";
import { attachmentRefusal } from "./attachments";
import * as repository from "./repository";
import type { SaveChatInput } from "./schema";
import type { SavedChat, SavedChatDetail } from "./types";

/**
 * The assistant panel's saved conversations (handoff v2 section 1.10).
 *
 * Every read and write is scoped to the signed-in person in the repository's own `where`,
 * not filtered after the fact, so a chat id belonging to somebody else matches nothing
 * rather than being fetched and then hidden. There is no permission beyond being signed
 * in: these are a person's own questions, and nobody else can reach them.
 */

/** The title the history list shows: the first thing they asked. */
const TITLE_LENGTH = 60;

/** The signed-in person's saved chats, most recent first. */
export async function listChats(): Promise<SavedChat[]> {
  const session = await requireSession();
  return repository.listChats(session.personId);
}

/** One of the signed-in person's chats with its turns, or null when it is not theirs. */
export async function readChat(chatId: string): Promise<SavedChatDetail | null> {
  const session = await requireSession();
  return repository.readChat(session.personId, chatId);
}

/** Saves after each answer and returns the id, which a new conversation did not have. */
export async function saveChat(input: SaveChatInput): Promise<string> {
  const session = await requireSession();
  const first = input.turns.find((turn) => turn.role === "user");
  // Cut between characters: the first turn names attached files with 📎, which slice() could halve.
  const title = Array.from((first?.text ?? "").trim()).slice(0, TITLE_LENGTH).join("") || repository.NEW_CHAT_TITLE;
  return repository.saveChat(session.personId, input.chatId ?? null, title, input.screen, input.turns);
}

/** D239: the name the history shows for a conversation, set by its owner. */
export async function renameChat(chatId: string, title: string): Promise<boolean> {
  const session = await requireSession();
  return repository.renameChat(session.personId, chatId, title);
}

/** How much of an attached file's text goes with the question. */
const ATTACHMENT_TEXT = 30_000;

/**
 * D239: the text of a file attached to a question, read by the agent service's document
 * parser as a request's receipt is; a zip is read file by file. `storable` says whether the
 * file store would keep it (D266): a zip, JSON or XLS file is read but not kept.
 */
export async function readAttachment(
  name: string,
  dataUrl: string,
): Promise<
  { ok: true; text: string; truncated: boolean; storable: boolean } | { ok: false; reason: string; reasonAr: string }
> {
  await requireSession();
  const decoded = bytesOfDataUrl(dataUrl);
  if (!decoded) return { ok: false, reason: "That file could not be read.", reasonAr: "تعذّرت قراءة هذا الملف." };
  const size = decoded.bytes.byteLength;
  const refusal = attachmentRefusal(name, size);
  if (refusal) return { ok: false, reason: refusal.en, reasonAr: refusal.ar };
  const read = await extractDocumentText(name, Buffer.from(decoded.bytes).toString("base64"));
  if (!read.ok) return read;
  return {
    ok: true,
    text: read.text.slice(0, ATTACHMENT_TEXT),
    truncated: read.text.length > ATTACHMENT_TEXT,
    storable: uploadRefusal({ name, mimeType: decoded.mimeType, size }) === null,
  };
}

/** Delete one of the signed-in person's chats. False when no chat of theirs has that id. */
export async function deleteChat(chatId: string): Promise<boolean> {
  const session = await requireSession();
  return repository.deleteChat(session.personId, chatId);
}
