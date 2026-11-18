"use server";

import { revalidatePath } from "next/cache";

import { answerAskedInput, answerInput, approvalKeyInput, decisionInput, readInput } from "./schema";
import * as service from "./service";

/** The Inbox mutations (S-12), each validated, permitted and audited by the service. */

/** `UC-12.1-02` ... `-11`: the decision, and what it did to the run and the other approvers. */
export async function decide(
  input: unknown,
): Promise<
  | { ok: true; settled: boolean; runResumed: boolean }
  | { ok: false; message: string; messageAr: string }
> {
  const values = decisionInput.parse(input);
  try {
    const outcome = await service.decideApproval(values);
    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    return { ok: true, settled: outcome.settled, runResumed: outcome.runResumed };
  } catch (error) {
    if (error instanceof service.InboxRejected || error instanceof service.StaleDecisionError) {
      return { ok: false, message: error.message, messageAr: error.messageAr };
    }
    throw error;
  }
}

/** D394: marks an Update as read. */
export async function markRead(input: unknown): Promise<void> {
  await service.markUpdateRead(readInput.parse(input).inboxItemId);
  revalidatePath("/inbox");
}

/** D281: the approval a panel run waits on, and whether the person decides it. */
export async function panelApproval(input: unknown): Promise<{ inboxItemId: string | null; approvers: string[] } | null> {
  return service.panelApproval(approvalKeyInput.parse(input).key);
}

/** D239: the answer to a question the assistant panel shows, by the question's id. */
export async function answerAsked(
  input: unknown,
): Promise<{ ok: true; runResumed: boolean } | { ok: false; message: string; messageAr: string }> {
  const { questionId, answer: text } = answerAskedInput.parse(input);
  try {
    const outcome = await service.answerAskedQuestion(questionId, text);
    revalidatePath("/inbox");
    return { ok: true, runResumed: outcome.runResumed };
  } catch (error) {
    if (error instanceof service.InboxRejected || error instanceof service.StaleDecisionError) {
      return { ok: false, message: error.message, messageAr: error.messageAr };
    }
    throw error;
  }
}

/** `UC-12.2-01` ... `-04`: the answer that resumes the run. */
export async function answer(
  input: unknown,
): Promise<{ ok: true; runResumed: boolean } | { ok: false; message: string; messageAr: string }> {
  const { inboxItemId, answer: text } = answerInput.parse(input);
  try {
    const outcome = await service.answerQuestion(inboxItemId, text);
    revalidatePath("/inbox");
    revalidatePath("/dashboard");
    return { ok: true, runResumed: outcome.runResumed };
  } catch (error) {
    if (error instanceof service.InboxRejected || error instanceof service.StaleDecisionError) {
      return { ok: false, message: error.message, messageAr: error.messageAr };
    }
    throw error;
  }
}
