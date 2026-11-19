import { Rejected } from "@/lib/rejection";

/** TAWP's requests, which a conversation could open. Hiwar captures leads instead (AGT-001 built-in tools). */
export async function createFromConversation(_input: {
  projectKey: string;
  requestTypeCode: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  attributes: Record<string, string>;
  externalContactId: string;
  channel: string;
}): Promise<string> {
  throw new Rejected("Hiwar has no requests. Use the capture_lead tool to keep the visitor's details.", "لا توجد طلبات في حوار. استخدم أداة حفظ بيانات الزائر.");
}

/* A run in Hiwar never has a request as its context: no decision to apply, nothing to note. */

export async function applyAgentDecision(_input: Record<string, unknown>): Promise<boolean> {
  return false;
}

export async function noteAgentStopped(_input: Record<string, unknown>): Promise<void> {}

/** No request types exist, so a storyline form cannot copy its fields from one. */
export async function loadRequestTypeDetail(
  _code: string,
): Promise<{
  attributes: { key: string; labelEn: string; labelAr: string; stepName: string | null; dataType: string; required: boolean; enumValues?: { value: string; labelEn: string; labelAr: string }[] }[];
} | null> {
  return null;
}
