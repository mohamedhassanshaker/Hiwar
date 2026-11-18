import { audit } from "@/lib/audit";
import { buckets, objectStoreConfigured, putObject } from "@/lib/objects";
import { bytesOfDataUrl, uploadRefusal } from "@/lib/uploads";
import { requirePermission, requireProjectPermission } from "@/lib/session";
import { activityActor } from "./actor";
import * as repository from "./repository";
import { WorkItemRejected } from "./errors";
import { createWorkItem } from "./write-service";

/** `UC-25.3-01`: a sub item of this work item, in its project. */
export async function addSubItem(parentKey: string, titleEn: string): Promise<string> {
  const session = await requirePermission("work_items:write");
  const parent = await repository.readForActions(parentKey);
  if (!parent) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  if (parent.type === "SubItem") throw new WorkItemRejected("A sub item has no sub items.", "البند الفرعي لا يحمل بنوداً فرعية.");

  const key = await createWorkItem({
    projectKey: parent.projectKey,
    type: "SubItem",
    titleEn,
    titleAr: titleEn,
    priority: "Medium",
    parentKey,
  });
  await repository.recordActivity({
    workItemId: parent.id,
    ...activityActor(session),
    eventType: "SubItemAdded",
    detailEn: `added the sub item ${key}`,
    detailAr: `أضاف البند الفرعي ${key}`,
  });
  return key;
}

/** `UC-25.3-02`: a sub item ticked off, which moves the parent's progress. */
export async function setSubItemDone(key: string, done: boolean): Promise<void> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", item.projectId);
  if (item.type !== "SubItem") throw new WorkItemRejected("That work item is not a sub item.", "بند العمل هذا ليس بنداً فرعياً.");

  await repository.setSubItemDone(key, done, session.personId);
  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "StatusChanged",
    detailEn: done ? "moved to Done" : "moved to ToDo",
    detailAr: done ? "نقل إلى منجز" : "نقل إلى قيد التنفيذ",
  });
}

/**
 * The agent working a work item stopped without finishing, recorded in the item's history so
 * a person reading it sees why nothing moved. The item stays where it is.
 * D384: also how a run's answer is posted, as the agent's comment, when the run ends.
 *
 * Called by `finishRun` for the run's own context, which the run row named. An item deleted
 * while the run went on has no history left to write to, and that must not stop the run finishing.
 */
export async function noteAgentStopped(input: { workItemId: string; agentId: string; detailEn: string; detailAr: string }): Promise<void> {
  if (!(await repository.workItemExists(input.workItemId))) return;
  await repository.recordActivity({
    workItemId: input.workItemId,
    actorType: "Agent",
    actorId: input.agentId,
    eventType: "Commented",
    detailEn: input.detailEn,
    detailAr: input.detailAr,
  });
}

/**
 * `UC-25.4-02`: a comment, and the people it names.
 *
 * An `@handle` is matched against the part of a person's address before the `@`, which is
 * what the console shows as a handle everywhere else.
 */
export async function comment(key: string, text: string): Promise<{ mentioned: string[] }> {
  const session = await requirePermission("work_items:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", item.projectId);
  if (!text.trim()) throw new WorkItemRejected("A comment needs something in it.", "التعليق لا يمكن أن يكون فارغاً.");

  await repository.recordActivity({
    workItemId: item.id,
    ...activityActor(session),
    eventType: "Commented",
    detailEn: text,
    detailAr: text,
  });

  const handles = [...text.matchAll(/@([a-zA-Z0-9._-]+)/g)].map((match) => match[1]);
  const people = await repository.peopleByHandle(handles);
  for (const person of people) {
    if (person.id === session.personId) continue;
    await repository.notifyMention({ personId: person.id, workItemId: item.id }, session.personId);
  }
  return { mentioned: people.map((person) => person.handle) };
}

/**
 * `UC-25.1-03` and `UC-25.1-05`: attach a file to a work item.
 *
 * The browser hands the bytes over as a `data:` URL, and they are judged here rather than
 * on the form: a browser can be told anything, and the store is shared by every screen.
 */
export async function attach(key: string, name: string, dataUrl: string): Promise<void> {
  const session = await requirePermission("files:write");
  const item = await repository.readForActions(key);
  if (!item) throw new WorkItemRejected("That work item no longer exists.", "لم يعد بند العمل هذا موجوداً.");
  await requireProjectPermission("work_items:write", item.projectId);
  await requireProjectPermission("files:write", item.projectId);

  const decoded = bytesOfDataUrl(dataUrl);
  if (!decoded) throw new WorkItemRejected("That file could not be read.", "تعذّرت قراءة هذا الملف.");

  const refusal = uploadRefusal({ name, mimeType: decoded.mimeType, size: decoded.bytes.byteLength });
  if (refusal) throw new WorkItemRejected(refusal.en, refusal.ar);

  if (!objectStoreConfigured()) throw new WorkItemRejected("The file store is not available.", "مخزن الملفات غير متاح.");
  const contentRef = await putObject(
    buckets.files,
    `work-items/${key}/${Date.now()}-${name}`,
    decoded.bytes,
    decoded.mimeType,
  );

  await repository.attachFile(
    {
      workItemId: item.id,
      projectKey: item.projectKey,
      name,
      contentRef,
      size: decoded.bytes.byteLength,
      mimeType: decoded.mimeType,
    },
    session.personId,
  );
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "files:write",
    objectType: "WorkItem",
    objectLabel: key,
    detail: { attached: name, bytes: decoded.bytes.byteLength },
  });
}
