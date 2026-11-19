"use server";

import { revalidatePath } from "next/cache";

import { act } from "@/server/actions";
import {
  addFaq,
  addWebsite,
  answerQuestion,
  deleteSource,
  dismissQuestion,
  faqInput,
  reprocess,
  setEnabled,
  websiteInput,
} from "@/server/knowledge";
import { apiMember } from "@/server/session";

const write = () => apiMember("manage_agents", { write: true });
const done = () => revalidatePath("/knowledge");

export async function addWebsiteAction(input: unknown) {
  return act(async () => {
    await addWebsite(await write(), websiteInput.parse(input));
    done();
  });
}
export async function addFaqAction(input: unknown) {
  return act(async () => {
    await addFaq(await write(), faqInput.parse(input));
    done();
  });
}
export async function reprocessAction(id: string) {
  return act(async () => {
    await reprocess(await write(), id);
    done();
  });
}
export async function setEnabledAction(id: string, enabled: boolean) {
  return act(async () => {
    await setEnabled(await write(), id, enabled);
    done();
  });
}
export async function deleteSourceAction(id: string) {
  return act(async () => {
    const name = await deleteSource(await write(), id);
    done();
    return name;
  });
}
export async function answerAction(id: string, answer: string) {
  return act(async () => {
    await answerQuestion(await write(), id, answer);
    done();
  });
}
export async function dismissAction(id: string) {
  return act(async () => {
    await dismissQuestion(await write(), id);
    done();
  });
}
