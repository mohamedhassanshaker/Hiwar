"use server";

import { revalidatePath } from "next/cache";

import { act } from "@/server/actions";
import { Unauthenticated, getSession } from "@/server/session";
import { changePassword, signOutOthers, switchOrganization, updateName } from "@/server/profile";

async function me() {
  const s = await getSession();
  if (!s) throw new Unauthenticated();
  return s;
}

export async function updateNameAction(name: string) {
  return act(async () => {
    await updateName(await me(), name);
    revalidatePath("/", "layout");
  });
}
export async function changePasswordAction(current: string, next: string) {
  return act(async () => {
    await changePassword(await me(), current, next);
  });
}
export async function signOutOthersAction() {
  return act(async () => signOutOthers(await me()));
}
export async function switchOrganizationAction(orgId: string) {
  return act(async () => {
    await switchOrganization(await me(), orgId);
    revalidatePath("/", "layout");
  });
}
