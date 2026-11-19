import { env } from "./env";
import { logger } from "./logger";

/**
 * Reading a document's text through the agent service's own parser (docling/Presidio),
 * the same route a request's receipt attachment uses (`UC-28.2-08`) and now a room's.
 *
 * Nothing here decides whether the caller may read the bytes in the first place — that is
 * each feature's own permission and ownership check, applied before this is ever reached.
 */

export type ExtractionOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string; reasonAr: string };

/** Extracts the text of one document's bytes, base64-encoded, by filename and content. */
export async function extractDocumentText(name: string, base64: string): Promise<ExtractionOutcome> {
  const agentServiceUrl = env().AI_AGENT_SERVICE_URL;
  if (!agentServiceUrl) {
    return { ok: false, reason: "The agent service is not configured.", reasonAr: "خدمة الوكلاء غير مُعدّة." };
  }
  if (base64 === "") return { ok: false, reason: "That file is empty.", reasonAr: "هذا الملف فارغ." };

  let response: Response;
  try {
    response = await fetch(`${agentServiceUrl}/documents/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: name, content_base64: base64 }),
    });
  } catch (problem) {
    logger().warn({ problem: String(problem) }, "the document extraction route did not answer");
    return { ok: false, reason: "The assistant could not read that file.", reasonAr: "تعذّر على المساعد قراءة هذا الملف." };
  }

  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { detail?: string };
    return {
      ok: false,
      reason: detail.detail ?? "The assistant could not read that file.",
      reasonAr: detail.detail ?? "تعذّر على المساعد قراءة هذا الملف.",
    };
  }

  const answer = (await response.json()) as { text?: string };
  const text = (answer.text ?? "").trim();
  return text === ""
    ? { ok: false, reason: "Nothing could be read from that file.", reasonAr: "لم يُقرأ أي نص من هذا الملف." }
    : { ok: true, text };
}
