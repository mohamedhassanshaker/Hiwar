"use server";

import { revalidatePath } from "next/cache";

import { act } from "@/server/actions";
import type { Role } from "@/server/authz";
import { apiMember } from "@/server/session";
import {
  cancelInvitation,
  changeRole,
  grantInput,
  grantSupport,
  invite,
  inviteInput,
  removeMember,
  resendInvitation,
  revokeSupport,
  securityInput,
  updateSecurity,
} from "@/server/team";

const done = () => revalidatePath("/team");

export async function inviteAction(input: { email: string; role: string; message?: string }) {
  return act(async () => {
    await invite(await apiMember("team", { write: true }), inviteInput.parse(input));
    done();
  });
}
export async function resendAction(id: string) {
  return act(async () => resendInvitation(await apiMember("team", { write: true }), id));
}
export async function cancelInviteAction(id: string) {
  return act(async () => {
    await cancelInvitation(await apiMember("team", { write: true }), id);
    done();
  });
}
export async function changeRoleAction(userId: string, role: Role) {
  return act(async () => {
    await changeRole(await apiMember("team", { write: true }), userId, role);
    done();
  });
}
export async function removeMemberAction(userId: string) {
  return act(async () => {
    await removeMember(await apiMember("team", { write: true }), userId);
    done();
  });
}
export async function securityAction(input: { require2fa: boolean; sessionDays: number }) {
  return act(async () => {
    await updateSecurity(await apiMember("team", { write: true }), securityInput.parse(input));
    done();
  });
}
export async function grantSupportAction(input: { hours: number; includeConversations: boolean }) {
  return act(async () => {
    await grantSupport(await apiMember("team", { write: true }), grantInput.parse(input));
    done();
  });
}
export async function revokeSupportAction() {
  return act(async () => {
    await revokeSupport(await apiMember("team", { write: true }));
    done();
  });
}
