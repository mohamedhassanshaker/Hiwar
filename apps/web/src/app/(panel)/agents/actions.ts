"use server";

import { revalidatePath } from "next/cache";

import type { TurnLine } from "@/server/agent-service";
import { act } from "@/server/actions";
import { createAgent, createHttpTool, updateHttpTool, duplicateAgent, publish, rollBack, saveDraft, testTurn } from "@/server/agents";
import { apiMember } from "@/server/session";

const write = () => apiMember("manage_agents", { write: true });
const done = () => revalidatePath("/agents", "layout");

export async function newAgentAction() {
  return act(async () => {
    const id = await createAgent(await write());
    done();
    return id;
  });
}
export async function duplicateAction(id: string) {
  return act(async () => {
    const copy = await duplicateAgent(await write(), id);
    done();
    return copy;
  });
}
export async function saveDraftAction(id: string, config: unknown) {
  return act(async () => {
    await saveDraft(await write(), id, config);
    done();
  });
}
export async function publishAction(id: string, config: unknown) {
  return act(async () => {
    const member = await write();
    await saveDraft(member, id, config);
    const n = await publish(member, id);
    done();
    return n;
  });
}
export async function rollBackAction(id: string, number: number) {
  return act(async () => {
    await rollBack(await write(), id, number);
    done();
  });
}
export async function addHttpToolAction(input: unknown) {
  return act(async () => {
    const id = await createHttpTool(await write(), input);
    done();
    return id;
  });
}
export async function updateHttpToolAction(toolId: string, input: unknown) {
  return act(async () => {
    await updateHttpTool(await write(), toolId, input);
    done();
  });
}
export async function testTurnAction(id: string, transcript: TurnLine[], editing: unknown) {
  return act(async () => testTurn(await apiMember("manage_agents"), id, transcript, editing));
}
