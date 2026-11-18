"use server";

import { revalidatePath } from "next/cache";

import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";
import {
  addStepInput,
  configureChannelInput,
  conversationActionInput,
  sendToVisitorInput,
  createDeploymentInput,
  deleteStepInput,
  createStorylineInput,
  deploymentCodeInput,
  mirrorRoomInput,
  saveDeploymentInput,
  setChannelEnabledInput,
  setModeInput,
  simulateInput,
  storylineStepInput,
  testChannelInput,
} from "./schema";
import * as service from "./service";
import * as conversations from "./conversations-service";

/**
 * S-61 to S-65 mutations.
 *
 * Each one returns an outcome rather than throwing, because every refusal here is something
 * the screen tells the person: a channel that is not built yet, a widget with nowhere to
 * run, a colour nobody can read, a storyline that is not ready.
 */

export async function setChannelEnabled(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setChannelEnabled(setChannelEnabledInput.parse(input)));
  revalidatePath("/channels");
  return outcome;
}

/** Saves a channel's settings and binding, then refreshes the Channels screen. */
export async function configureChannel(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.configureChannel(configureChannelInput.parse(input)));
  revalidatePath("/channels");
  return outcome;
}

/** Runs a channel's live checks and returns them, then refreshes the Channels screen. */
export async function testChannel(input: unknown) {
  const outcome = await attempt(() => service.testChannel(testChannelInput.parse(input)));
  revalidatePath("/channels");
  return outcome;
}

/** Creates a Draft deployment, then refreshes the deployments screen. */
export async function createDeployment(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.createDeployment(createDeploymentInput.parse(input)));
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** Saves a deployment's settings, then refreshes the deployments screen. */
export async function saveDeployment(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.saveDeployment(saveDeploymentInput.parse(input)));
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** The conversation count a delete confirmation shows. Throws rather than returning an outcome. */
export async function deploymentConversationCount(input: unknown): Promise<number> {
  return service.deploymentConversationCount(deploymentCodeInput.parse(input).code);
}

/** Deletes a deployment and everything under it; refreshes the screen only when it was deleted. */
export async function deleteDeployment(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.deleteDeployment(deploymentCodeInput.parse(input).code));
  if (outcome.ok) revalidatePath("/embedded-deployment");
  return outcome;
}

/** The request form's fields of a request type, for a Form step to copy. */
export async function requestTypeFields(requestTypeCode: string) {
  return attempt(() => service.requestTypeFields(requestTypeCode));
}

/**
 * Gives a deployment its opening storyline, or a named scenario, as an empty draft. The input is
 * parsed inside `attempt`: a code or name the person typed that the schema refuses is a message
 * on the form, not a thrown error that answers 500.
 */
export async function createStoryline(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => {
    const parsed = createStorylineInput.parse(input);
    return service.createStoryline(parsed.code, parsed.storyline);
  });
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** Saves one step of a storyline's draft. */
export async function saveStorylineStep(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.saveStorylineStep(storylineStepInput.parse(input)));
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** Adds a step to a storyline's draft after the selected one. */
export async function addStorylineStep(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.addStorylineStep(addStepInput.parse(input)));
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** Deletes a step from a storyline's draft and returns the steps that pointed at it. */
export async function deleteStorylineStep(input: unknown) {
  const outcome = await attempt(() => service.deleteStorylineStep(deleteStepInput.parse(input)));
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** Sets a storyline draft's mode. */
export async function setStorylineMode(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => service.setStorylineMode(setModeInput.parse(input)));
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** Publishes a storyline's draft and returns the version number, or the problems that block it. */
export async function publishStorylineDraft(code: string) {
  const outcome = await attempt(() => service.publishStoryline(code));
  revalidatePath("/embedded-deployment");
  return outcome;
}

/** Runs a storyline's draft against test replies without writing or calling anything. */
export async function simulateStoryline(input: unknown) {
  return attempt(() => service.simulateStoryline(simulateInput.parse(input)));
}

/** Links a discussion room to a conversation on a channel, then refreshes the rooms screen. */
export async function mirrorRoom(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => {
    const parsed = mirrorRoomInput.parse(input);
    return service.mirrorRoom({ roomKey: parsed.roomKey, channelType: parsed.type, externalRef: parsed.externalRef });
  });
  revalidatePath("/discussion-rooms");
  return outcome;
}

/** D342: a person takes a visitor conversation over from its agent. */
export async function takeOverConversation(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => conversations.takeOver(conversationActionInput.parse(input)));
  revalidatePath("/conversations");
  return outcome;
}

/** D342: the agent answers the conversation again. */
export async function resumeConversationAgent(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => conversations.resumeAgent(conversationActionInput.parse(input)));
  revalidatePath("/conversations");
  return outcome;
}

/** D342: a person writes to the visitor of a conversation they have taken over. */
export async function sendConversationMessage(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => conversations.sendToVisitor(sendToVisitorInput.parse(input)));
  revalidatePath("/conversations");
  return outcome;
}

/** D342: a person ends the conversation. */
export async function endConversationByPerson(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(() => conversations.endByPerson(conversationActionInput.parse(input)));
  revalidatePath("/conversations");
  return outcome;
}
