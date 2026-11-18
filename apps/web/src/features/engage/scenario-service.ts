import { Rejected } from "@/lib/rejection";
import { requirePermission } from "@/lib/session";
import { startScenario } from "./conversation";
import * as repository from "./repository";

/**
 * The deployment's agent starts a scenario from what a visitor typed (widget specification
 * 8, D231): "I want to pay my etisalat bill" starts the same storyline the quick action
 * does, with the values the agent found passed as a prefill the engine checks like any
 * other answer.
 *
 * Only a run answering a widget conversation may, and only that conversation: the run is
 * the token's own, and its context is read from the run row, never from the arguments.
 */

export class ScenarioRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "ScenarioRejected";
  }
}

/**
 * The widget conversation the calling run answers, read from the run row of the session's acting
 * agent. Requires `agents:invoke`; refused for a person, or a run whose context is not a widget
 * conversation.
 */
async function conversationOfCaller(): Promise<string> {
  const session = await requirePermission("agents:invoke");
  const runId = session.actingAgent?.runId;
  const conversationId = runId ? await repository.conversationOfRun(runId) : null;
  if (!conversationId) {
    throw new ScenarioRejected(
      "Only an agent answering a website visitor can start one of the website's services.",
      "لا يبدأ خدمات الموقع إلا وكيل يرد على زائر الموقع.",
    );
  }
  return conversationId;
}

/** The services the visitor's website offers, as its quick actions name them. */
export async function scenariosForCaller(): Promise<{ scenario: string; labelEn: string; labelAr: string }[]> {
  const conversation = await repository.readConversation(await conversationOfCaller());
  const deployment = conversation ? await repository.readRunnableDeployment(conversation.deploymentCode) : null;
  return (deployment?.quickActions ?? []).map((action) => ({ scenario: action.storyline, labelEn: action.labelEn, labelAr: action.labelAr }));
}

/** Starts one of them in the visitor's conversation, with the values already given. */
export async function startScenarioForCaller(input: { scenario: string; prefill: Record<string, string> }): Promise<{ started: string }> {
  const conversationId = await conversationOfCaller();
  const conversation = await repository.readConversation(conversationId);
  const deployment = conversation ? await repository.readRunnableDeployment(conversation.deploymentCode) : null;
  const quick = deployment?.quickActions.find((action) => action.storyline === input.scenario);
  if (!conversation || !deployment || !quick) {
    throw new ScenarioRejected(`The website offers no service ${input.scenario}.`, `لا يقدّم الموقع خدمة ${input.scenario}.`);
  }
  if (quick.minIdentity !== "anonymous") {
    throw new ScenarioRejected("That service needs the visitor to verify first; offer its button instead.", "تتطلب هذه الخدمة تحقق الزائر أولاً؛ اعرض زرها بدلاً من ذلك.");
  }
  await startScenario({
    conversationId,
    visitorKey: conversation.visitorKey ?? "",
    scenario: input.scenario,
    label: quick.labelEn,
    prefill: input.prefill,
  });
  return { started: input.scenario };
}
