"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { type FieldNames, type InputRefusal, inputRefusal } from "@/lib/input-refusal";
import type { Outcome } from "@/lib/outcome";
import { attempt } from "@/lib/outcome.server";

import type { Task } from "./types";
import {
  changeStatusInput,
  createWorkItemInput,
  approveInput,
  assignInput,
  assignToAgentInput,
  attachInput,
  commentInput,
  reasonInput,
  saveViewInput,
  searchInput,
  similarInput,
  subItemDoneInput,
  subItemInput,
  workItemKeyInput,
} from "./schema";
import * as service from "./service";

/** S-24 and S-25 mutations. Each one is validated, permitted and audited by the service. */

/** What the typed fields are called in a refusal, in English and in Arabic. */
const FIELDS: FieldNames = {
  titleEn: ["The title", "العنوان"],
  titleAr: ["The title", "العنوان"],
  descriptionEn: ["The description", "الوصف"],
  keyword: ["The keyword", "الكلمة المفتاحية"],
  text: ["The text", "النص"],
  reason: ["The reason", "السبب"],
  override: ["The reason", "السبب"],
};

/**
 * The input as `schema` reads it, or the refusal to hand back to the form. A value the person typed that the
 * schema refuses is an ordinary refusal: thrown, it reaches the browser with its message removed and the form
 * can only say "Something went wrong" (`lib/outcome.ts`).
 */
function readInput<S extends z.ZodType>(schema: S, input: unknown): { ok: true; values: z.infer<S> } | InputRefusal {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, values: parsed.data } : inputRefusal(parsed.error, FIELDS);
}

/** `UC-24.3-01` ... `-09`: create a work item, or say why it was refused. */
export async function createWorkItem(
  input: unknown,
): Promise<{ ok: true; key: string } | { ok: false; message: string; messageAr: string }> {
  const read = readInput(createWorkItemInput, input);
  if (!read.ok) return read;
  const values = read.values;
  try {
    const key = await service.createWorkItem(values);
    revalidatePath("/work-items");
    if (values.requestKey) revalidatePath("/requests");
    revalidatePath("/dashboard");
    return { ok: true, key };
  } catch (error) {
    if (error instanceof service.WorkItemRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** Deletes a work item, or says what is still using it. */
export async function deleteWorkItem(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const { key } = workItemKeyInput.parse(input);
  try {
    await service.deleteWorkItem(key);
    revalidatePath("/work-items");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.WorkItemRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/**
 * `UC-24.1-07`: moves a work item to a status through `service.changeStatus` at the version the
 * screen read, refreshing the board and the dashboard. A `WorkItemRejected` comes back as its
 * message in both languages; any other error is thrown.
 */
export async function changeStatus(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string; messageAr: string }> {
  const values = changeStatusInput.parse(input);
  try {
    await service.changeStatus(values);
    revalidatePath("/work-items");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof service.WorkItemRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-24.2-01` ... `-05`: the advanced search. */
export async function searchWorkItems(
  input: unknown,
): Promise<{ ok: true; items: Task[] } | { ok: false; message: string; messageAr: string }> {
  const read = readInput(searchInput, input);
  if (!read.ok) return read;
  const criteria = read.values;
  try {
    return { ok: true, items: await service.searchWorkItems(criteria) };
  } catch (error) {
    if (error instanceof service.WorkItemRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-24.2-02`: keep a set of criteria under a name. */
export async function saveView(input: unknown): Promise<Outcome<void>> {
  const outcome = await attempt(async () => {
    const { name, filter } = saveViewInput.parse(input);
    await service.saveView(name, filter);
  });
  revalidatePath("/work-items");
  return outcome;
}

/** `UC-24.3-05`: open items in the same project that read like this title. */
export async function similarOpenItems(
  input: unknown,
): Promise<{ key: string; titleEn: string }[]> {
  const parsed = similarInput.safeParse(input);
  // A title past the limit has nothing to look up; the form refuses it when it is submitted.
  if (!parsed.success) return [];
  return service.similarOpenItems(parsed.data.projectKey, parsed.data.title);
}

/** Everything the drawer does, each one reporting what it did or why it did not. */
type Result = { ok: true } | { ok: false; message: string; messageAr: string };

/**
 * Runs one drawer action, refreshes the board, the dashboard and `paths`, and returns ok, or a
 * `WorkItemRejected` as its message in both languages. Any other error is thrown.
 */
async function act(work: () => Promise<void>, ...paths: string[]): Promise<Result> {
  try {
    await work();
    for (const path of ["/work-items", "/dashboard", ...paths]) revalidatePath(path);
    return { ok: true };
  } catch (error) {
    if (error instanceof service.WorkItemRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-25.2-01`: hand the work to its reviewer. */
export async function submitForReview(input: unknown): Promise<Result> {
  const { key } = workItemKeyInput.parse(input);
  return act(() => service.submitForReview(key));
}

/** `UC-25.2-02` and `-08`: finish it, with a reason when sub items are still open. */
export async function approve(input: unknown): Promise<Result> {
  const read = readInput(approveInput, input);
  if (!read.ok) return read;
  const { key, override } = read.values;
  return act(() => service.approve(key, override));
}

/** `UC-25.2-03`: send it back with what to change. */
export async function requestChanges(input: unknown): Promise<Result> {
  const read = readInput(commentInput, input);
  if (!read.ok) return read;
  const { key, text } = read.values;
  return act(() => service.requestChanges(key, text));
}

/** `UC-25.2-05`: take the block off. */
export async function unblock(input: unknown): Promise<Result> {
  const { key } = workItemKeyInput.parse(input);
  return act(async () => {
    await service.unblock(key);
  });
}

/** `UC-25.2-07`: reopen finished work, with why. */
export async function reopen(input: unknown): Promise<Result> {
  const read = readInput(reasonInput, input);
  if (!read.ok) return read;
  const { key, reason } = read.values;
  return act(() => service.reopen(key, reason));
}

/** `UC-24.3-01`: give it to a person, or to an agent, which starts on it. */
export async function assign(input: unknown): Promise<Result> {
  const { key, assignee } = assignInput.parse(input);
  return act(() => service.assign(key, assignee));
}

/** `UC-25.2-06`: give it to an agent, which starts on it. */
export async function assignToAgent(input: unknown): Promise<Result> {
  const { key, agentCode } = assignToAgentInput.parse(input);
  return act(() => service.assignToAgent(key, agentCode));
}

/** `UC-25.3-01`: a sub item of this one. */
export async function addSubItem(input: unknown): Promise<Result> {
  const read = readInput(subItemInput, input);
  if (!read.ok) return read;
  const { parentKey, titleEn } = read.values;
  return act(async () => {
    await service.addSubItem(parentKey, titleEn);
  });
}

/** `UC-25.3-02`: a sub item ticked off, or not. */
export async function setSubItemDone(input: unknown): Promise<Result> {
  const { key, done } = subItemDoneInput.parse(input);
  return act(() => service.setSubItemDone(key, done));
}

/** `UC-25.4-02`: a comment, and whoever it named. */
export async function comment(
  input: unknown,
): Promise<{ ok: true; mentioned: string[] } | { ok: false; message: string; messageAr: string }> {
  const read = readInput(commentInput, input);
  if (!read.ok) return read;
  const { key, text } = read.values;
  try {
    const { mentioned } = await service.comment(key, text);
    revalidatePath("/work-items");
    return { ok: true, mentioned };
  } catch (error) {
    if (error instanceof service.WorkItemRejected) return { ok: false, message: error.message, messageAr: error.messageAr };
    throw error;
  }
}

/** `UC-25.1-03` and `-05`: attach a file, or say why it was refused. */
export async function attach(input: unknown): Promise<Result> {
  const { key, name, dataUrl } = attachInput.parse(input);
  return act(() => service.attach(key, name, dataUrl));
}
