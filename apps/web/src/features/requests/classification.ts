"use server";

import { isFeatureEnabled } from "@/features/governance/service";
import { extractDocumentText, type ExtractionOutcome } from "@/lib/documents";
import { env } from "@/lib/env";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import { requirePermission } from "@/lib/session";
import { loadPublishedTypes } from "./directory";

/**
 * `UC-28.2-01` … `-06`: turning what somebody wrote into a proposed request.
 *
 * The model call itself belongs to the agent service, which owns the gateway and its typed
 * routes. This assembles the types the person may actually raise, asks for a classification
 * against exactly those, and hands the answer back for them to confirm or correct.
 *
 * Nothing is submitted here. A classification is a proposal, and `UC-28.2-02` is the person
 * agreeing to it.
 */

export type Proposal = {
  typeCode: string;
  confidence: number;
  title: string;
  attributes: Record<string, string>;
  /** Required attributes the text did not give (`UC-28.2-05`). */
  missing: string[];
  /** Types that also fit, when the choice was not clear (`UC-28.2-04`). */
  candidates: string[];
  /** What to ask the person next, when something is missing or unclear. */
  question: string;
};

export type ClassificationOutcome =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: string; reasonAr: string };

/** Whether the console offers the agentic entry mode at all: the agent service and its flag (`UC-28.2-07`, D310). */
export async function agenticEntryAvailable(): Promise<boolean> {
  return Boolean(env().AGENT_SERVICE_URL) && (await isFeatureEnabled(FEATURE_FLAGS.agenticRequestEntry));
}

/**
 * How long the console waits for a classification before offering the form instead.
 *
 * Long enough for a model that thinks before it answers, short enough that nobody watches a
 * disabled button wondering whether it is working.
 */
const CLASSIFY_TIMEOUT_MS = 30_000;

/**
 * Asks the agent service's `/classify/request` to propose a request type, title and attribute
 * values for the text, against the published types with their form attributes. Needs
 * `requests:write`. Refused, with a reason in both languages that points to the form, when the
 * agent service is not configured, the agentic entry flag is off, no type is published, the
 * service does not answer within 30 seconds, or it answers with an error.
 */
export async function classifyRequest(text: string): Promise<ClassificationOutcome> {
  await requirePermission("requests:write");

  const agentServiceUrl = env().AGENT_SERVICE_URL;
  if (!agentServiceUrl) {
    return { ok: false, reason: "The agent service is not configured.", reasonAr: "خدمة الوكلاء غير مُعدّة." };
  }
  if (!(await isFeatureEnabled(FEATURE_FLAGS.agenticRequestEntry))) {
    return { ok: false, reason: "Agentic request entry is turned off.", reasonAr: "إدخال الطلبات التفاعلي بالوكيل متوقف." };
  }

  // `UC-28.1-06`: only the types this person may submit are offered to the classifier, so
  // it cannot propose one they are not allowed to raise.
  const types = await loadPublishedTypes();
  if (types.length === 0) {
    return { ok: false, reason: "There are no published request types.", reasonAr: "لا توجد أنواع طلبات منشورة." };
  }

  let response: Response;
  try {
    response = await fetch(`${agentServiceUrl}/classify/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `UC-28.2-06`: a model that is slow rather than broken must still reach the fallback.
      // Without a bound the screen waits for as long as the provider takes, and the person
      // is left with a disabled Send and no way back to the form.
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
      body: JSON.stringify({
        text,
        types: types.map((type) => ({
          code: type.code,
          name: type.nameEn,
          attributes: type.attributes.map((attribute) => ({
            key: attribute.key,
            label: attribute.labelEn,
            data_type: attribute.dataType,
            required: attribute.required,
            options: (attribute.enumValues ?? []).map((option) => option.value),
          })),
        })),
      }),
    });
  } catch (problem) {
    const timedOut = problem instanceof DOMException && problem.name === "TimeoutError";
    logger().warn(
      { problem: String(problem), timedOut },
      timedOut ? "the classification route did not answer in time" : "the classification route did not answer",
    );
    return {
      ok: false,
      reason: timedOut
        ? "The assistant is taking too long. You can use the template form instead."
        : "The assistant is unavailable. You can use the template form instead.",
      reasonAr: timedOut
        ? "المساعد يستغرق وقتاً طويلاً. يمكنك استخدام النموذج بدلاً من ذلك."
        : "المساعد غير متاح. يمكنك استخدام النموذج بدلاً من ذلك.",
    };
  }

  // `UC-28.2-06`: the route retried and still produced nothing usable, so the person is
  // offered the form with whatever they have typed rather than left with an error.
  if (!response.ok) {
    return {
      ok: false,
      reason: "The assistant could not read that. You can use the template form instead.",
      reasonAr: "تعذّر على المساعد قراءة ذلك. يمكنك استخدام النموذج بدلاً من ذلك.",
    };
  }

  const answer = (await response.json()) as {
    type_code?: string;
    confidence?: number;
    title?: string;
    attributes?: Record<string, string>;
    missing?: string[];
    candidates?: string[];
    question?: string;
  };
  return {
    ok: true,
    proposal: {
      typeCode: answer.type_code ?? "",
      confidence: answer.confidence ?? 0,
      title: answer.title ?? "",
      attributes: answer.attributes ?? {},
      missing: answer.missing ?? [],
      candidates: answer.candidates ?? [],
      question: answer.question ?? "",
    },
  };
}

/**
 * `UC-28.2-08`: reads an attached receipt so the proposal can be filled from it.
 *
 * The agent service owns the parser, as it does for knowledge ingestion: a photograph is
 * recognised, a PDF is exported, and a format nothing can read says so rather than coming
 * back as an empty receipt. An empty result is a refusal, not a receipt with nothing on it: a
 * blank string fed to the classifier would propose values from the words around it instead.
 */
export async function extractAttachment(name: string, dataUrl: string): Promise<ExtractionOutcome> {
  await requirePermission("requests:write");
  return extractDocumentText(name, dataUrl.slice(dataUrl.indexOf(",") + 1));
}
