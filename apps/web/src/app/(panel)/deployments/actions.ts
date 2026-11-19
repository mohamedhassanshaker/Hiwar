"use server";

import { revalidatePath } from "next/cache";

import { act } from "@/server/actions";
import {
  addOrigin,
  changeAgent,
  createDeployment,
  removeOrigin,
  rotateKey,
  saveSettings,
  sendToDeveloper,
  setStatus,
  verifyOrigin,
} from "@/server/deployments";
import { apiMember } from "@/server/session";

const write = () => apiMember("manage_deployments", { write: true });
const done = () => revalidatePath("/deployments", "layout");

export async function createAction(name: string, agentId: string) {
  return act(async () => {
    const id = await createDeployment(await write(), name, agentId);
    done();
    return id;
  });
}
export async function rotateAction(id: string) {
  return act(async () => {
    await rotateKey(await write(), id);
    done();
  });
}
export async function sendDevAction(id: string, email: string) {
  return act(async () => sendToDeveloper(await write(), id, email));
}
export async function addOriginAction(id: string, origin: string) {
  return act(async () => {
    await addOrigin(await write(), id, origin);
    done();
  });
}
export async function removeOriginAction(id: string, originId: string) {
  return act(async () => {
    const r = await removeOrigin(await write(), id, originId);
    done();
    return r;
  });
}
export async function verifyAction(id: string, originId: string) {
  return act(async () => {
    const r = await verifyOrigin(await write(), id, originId);
    done();
    return r;
  });
}
export async function statusAction(id: string, status: "live" | "paused") {
  return act(async () => {
    await setStatus(await write(), id, status);
    done();
  });
}
export async function settingsAction(id: string, settings: unknown) {
  return act(async () => {
    await saveSettings(await write(), id, settings);
    done();
  });
}
export async function agentAction(id: string, agentId: string) {
  return act(async () => {
    await changeAgent(await write(), id, agentId);
    done();
  });
}
