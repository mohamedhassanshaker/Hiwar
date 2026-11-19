"use server";

import { act } from "@/server/actions";
import { approve, reject } from "@/server/approvals";
import { claim, closeByStaff, handBack, release, staffMessage, takeOver } from "@/server/inbox";
import { apiMember } from "@/server/session";

const writer = () => apiMember("take_over", { write: true });

export async function takeOverAction(id: string, version: number) {
  return act(async () => takeOver(await writer(), id, version));
}
export async function claimAction(id: string) {
  return act(async () => claim(await writer(), id));
}
export async function handBackAction(id: string, note: string, tellVisitor: boolean) {
  return act(async () => handBack(await writer(), id, note, tellVisitor));
}
export async function releaseAction(id: string) {
  return act(async () => release(await writer(), id));
}
export async function closeAction(id: string) {
  return act(async () => closeByStaff(await apiMember("conversations", { write: true }), id));
}
export async function sendAction(id: string, mode: "reply" | "note", text: string, version: number) {
  return act(async () => staffMessage(await apiMember("conversations", { write: true }), id, mode, text, version));
}
export async function approveAction(toolCallId: string) {
  return act(async () => approve(await writer(), toolCallId));
}
export async function rejectAction(toolCallId: string, reason: string) {
  return act(async () => reject(await writer(), toolCallId, reason));
}
