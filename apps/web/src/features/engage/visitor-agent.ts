import { RunNotStarted, startRun } from "@/features/agents/service";
import { logger } from "@/lib/logger";
import { NotPermitted, runAs } from "@/lib/session";
import * as repository from "./repository";
import { type RunnableDeployment } from "./repository";
import { type VisitorLine } from "./conversation-view";

/**
 * A visitor's free conversation answered by the deployment's agent (D221).
 *
 * A visitor is anonymous and every run acts as a person, so the agent acts as the service
 * identity an administrator set on the deployment: what it may read and do is that person's
 * permissions with the agent's grant, as for any run (D31). The identity comes from the
 * stored deployment, never from the visitor. The reply arrives when the run finishes
 * (`postVisitorReply`); until then the view says a reply is pending.
 */

function systemLine(en: string, ar: string): VisitorLine {
  return { role: "System", kind: "Message", textEn: en, textAr: ar, payload: {} };
}

/** Starts the deployment's agent on the visitor's message, or says why it cannot answer. */
export async function askAgent(conversationId: string, deployment: RunnableDeployment, text: string): Promise<void> {
  if (!deployment.runAsPersonId || !deployment.defaultAgentCode) {
    await repository.appendConversationMessages(conversationId, [
      systemLine(
        "This assistant is not set up to answer yet. You can ask for a person instead.",
        "هذا المساعد غير مهيأ للرد بعد. يمكنك طلب التحدث مع موظف.",
      ),
    ]);
    return;
  }
  const transcript = await repository.readTranscript(conversationId);
  // The visitor's language, not the service identity's (widget specification 13.2).
  const stored = await repository.readConversation(conversationId);
  const locale = (stored?.stateJson as { lang?: string } | null)?.lang === "ar" ? ("ar" as const) : ("en" as const);
  // Earlier turns, without the message just written, which is the run's prompt.
  const conversation = transcript
    .slice(0, -1)
    .filter((line) => line.textEn && (line.role === "Visitor" || line.role === "Agent"))
    .map((line) => ({ role: line.role === "Visitor" ? ("user" as const) : ("assistant" as const), text: line.textEn ?? "" }));
  try {
    await runAs(deployment.runAsPersonId, { id: deployment.id, label: `Widget ${deployment.code}` }, () =>
      startRun({ agentCode: deployment.defaultAgentCode as string, prompt: text, surface: "Deployment", contextId: conversationId, conversation, locale }),
    );
  } catch (problem) {
    if (!(problem instanceof RunNotStarted || problem instanceof NotPermitted)) throw problem;
    logger().warn({ deployment: deployment.code, problem: String(problem) }, "a visitor's agent run did not start");
    await repository.appendConversationMessages(conversationId, [
      systemLine("The assistant cannot answer right now. You can ask for a person instead.", "لا يستطيع المساعد الرد الآن. يمكنك طلب التحدث مع موظف."),
    ]);
  }
}

/** The finished run's answer, written into the conversation it was about. */
export async function postVisitorReply(input: { conversationId: string; status: string; text: string }): Promise<void> {
  // A person took the conversation over while the run worked (D342): the agent says nothing.
  const conversation = await repository.readConversation(input.conversationId);
  if (conversation?.agentPausedAt) {
    logger().info({ conversationId: input.conversationId }, "an agent reply was dropped: a person has taken the conversation over");
    return;
  }
  const line: VisitorLine =
    input.status === "Succeeded" && input.text.trim() !== ""
      ? { role: "Agent", kind: "Message", textEn: input.text, textAr: input.text, payload: {} }
      : systemLine("The assistant could not answer this. You can ask for a person instead.", "لم يتمكن المساعد من الرد على هذا. يمكنك طلب التحدث مع موظف.");
  await repository.appendConversationMessages(input.conversationId, [line]);
}
