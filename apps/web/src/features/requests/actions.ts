"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import {
  assignRequestToAgentInput,
  attributeInput,
  audienceInput,
  createRequestInput,
  createRequestTypeInput,
  decisionInput,
  deleteRequestTypeInput,
  deleteStepInput,
  moveStepInput,
  publishRequestTypeInput,
  removeAttributeInput,
  requestKeyInput,
  ruleInput,
  saveDraftInput,
  updateAttributeInput,
  updateRuleInput,
  setStepSlaInput,
  setStepTerminalInput,
  stepActionInput,
  stepEntryInput,
  stepInput,
} from "./schema";
import * as service from "./service";

/** S-27 to S-30 mutations. */

/** A request type change shows on the designer (`/request-types`) and on the request list. */
function revalidateTypes(): void {
  revalidatePath("/request-types");
  revalidatePath("/requests");
}

/** Raises a request; the outcome carries its key. Refreshes the request list and the dashboard. */
export async function createRequest(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.createRequest(createRequestInput.parse(input)));
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  return outcome;
}

/** `UC-30.4-01`: publish the type's draft; refused while its flow has a hole. */
export async function publishRequestType(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.publishRequestType(publishRequestTypeInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/* ---------------------------------------------------- S-29: acting on a request's step */

/** `UC-29.2-01`: take an action the current step offers, and route the request. */
export async function takeStepAction(input: unknown): Promise<Outcome<service.StepOutcome>> {
  const outcome = await attempt(() => service.takeStepAction(stepActionInput.parse(input)));
  revalidatePath("/requests");
  return outcome;
}

/** `UC-29.2-02`: send the request back to its requester with a comment. */
export async function requestChanges(input: unknown): Promise<Outcome<{ toStepName: string | null }>> {
  const parsed = decisionInput.parse(input);
  const outcome = await attempt(() => service.requestChanges(parsed.key, parsed.comment, parsed.attachments));
  revalidatePath("/requests");
  return outcome;
}

/** D218: end the request as Rejected from the step it is at, with why. */
export async function rejectRequest(input: unknown): Promise<Outcome<void>> {
  const parsed = decisionInput.parse(input);
  const outcome = await attempt(() => service.rejectRequest(parsed.key, parsed.comment, parsed.attachments));
  revalidatePath("/requests");
  return outcome;
}

/** `UC-29.2-03`: hand the current step to an agent. */
export async function assignRequestToAgent(input: unknown): Promise<Outcome<{ started: boolean; reason: string | null }>> {
  const outcome = await attempt(() => service.assignToAgent(assignRequestToAgentInput.parse(input)));
  revalidatePath("/requests");
  return outcome;
}

/** `UC-29.2-06`: the actions this person is offered, which may be none. */
export async function actionsForRequest(key: string): Promise<service.OfferedActions> {
  return service.actionsFor(key);
}

/** D147: take the request's current step, so the other audiences wait. */
export async function takeRequestStep(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.takeStep(requestKeyInput.parse(input).key));
  revalidatePath("/requests");
  return outcome;
}

/** D147: hand a taken step back. */
export async function releaseRequestStep(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.releaseStep(requestKeyInput.parse(input).key));
  revalidatePath("/requests");
  return outcome;
}

/* ------------------------------------------------- S-30: editing a request type's draft */

/** `UC-27.2-02`: create a request type, which opens on its first draft. */
export async function createRequestType(input: unknown): Promise<Outcome<string>> {
  const outcome = await attempt(() => service.createRequestType(createRequestTypeInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.1-01`: save the draft's general settings. */
export async function saveRequestTypeDraft(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.saveDraft(saveDraftInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.2-01`: add a step to the draft. */
export async function addRequestTypeStep(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.addStep(stepInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.1-01`: a step's SLA, a count and the interval it counts. */
export async function setRequestTypeStepSla(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setStepSla(setStepSlaInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.2-04`: mark a draft step terminal or not. */
export async function setRequestTypeStepTerminal(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setStepTerminal(setStepTerminalInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.2-01`: a step moved up or down the draft's order. */
export async function moveRequestTypeStep(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.moveStep(moveStepInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.2-09`: deleting a step names the rules that point at it first. */
export async function deleteRequestTypeStep(input: unknown): Promise<Outcome<service.StepRemoval>> {
  const outcome = await attempt(() => service.deleteStep(deleteStepInput.parse(input)));
  if (outcome.ok && outcome.value.removed) revalidateTypes();
  return outcome;
}

/** `UC-30.2-02`: add an audience to a draft step. */
export async function addRequestTypeAudience(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.addAudience(audienceInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.2-03`: add a routing rule out of a draft step. */
export async function addRequestTypeRule(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.addRule(ruleInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.3-01`: add an attribute to the draft, asked on the form or at one step. */
export async function addRequestTypeAttribute(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.addAttribute(attributeInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** D293: delete a request type, and its requests only when asked. */
export async function deleteRequestType(input: unknown): Promise<Outcome<void>> {
  const { code, withRequests } = deleteRequestTypeInput.parse(input);
  const outcome = await attempt(() => service.deleteRequestType(code, withRequests));
  revalidatePath("/request-types");
  revalidatePath("/requests");
  return outcome;
}

/** `UC-30.2-02`: remove a draft step's audience by its position. */
export async function removeRequestTypeAudience(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.removeAudience(stepEntryInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** `UC-30.2-03`: remove a draft step's routing rule by its position. */
export async function removeRequestTypeRule(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.removeRule(stepEntryInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** D309: change a routing rule of a draft step. */
export async function updateRequestTypeRule(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.updateRule(updateRuleInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** D304: change an attribute of the draft. */
export async function updateRequestTypeAttribute(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    await service.updateAttribute(updateAttributeInput.parse(input));
  });
  revalidateTypes();
  return outcome;
}

/** `UC-30.3-03`: remove an attribute from the draft. */
export async function removeRequestTypeAttribute(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.removeAttribute(removeAttributeInput.parse(input)));
  revalidateTypes();
  return outcome;
}

/** Deletes a request with its history; refused while anything still points at it. The list is refreshed only on success. */
export async function deleteRequest(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.deleteRequest(requestKeyInput.parse(input).key));
  if (outcome.ok) revalidatePath("/requests");
  return outcome;
}

