import { eq, sql } from "drizzle-orm";

import { db, schema as s } from "../client";

/**
 * Raising a work item, as more than one feature module needs to.
 *
 * It began in `features/work-items/repository.ts`, and stayed there while work items were
 * only ever raised from the work-items screens. Handoff v2's "Make it a task" raises one
 * from a comment on a dashboard card, so the primitive sits here, beside the other queries
 * two modules share, rather than one module reaching into another's repository.
 */

/** The next key in a project's sequence, which is what the console shows as the id. */
async function nextKey(prefix: string): Promise<string> {
  const { rows } = await db().execute<{ next: number }>(sql`
    select coalesce(max(substring(key from '[0-9]+$')::int), 2300) + 1 as next
    from work.work_item where key like ${`${prefix}-%`}
  `);
  return `${prefix}-${rows[0]?.next ?? 2301}`;
}

export type NewWorkItem = {
  projectKey: string;
  type: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  assignee: { type: string; id: string } | null;
  reviewerId: string | null;
  priority: string;
  dueAt: Date | null;
  parentKey: string | null;
  /** Decided by the service: Backlog with nobody on it, To do with an assignee. */
  status: string;
  /** `UC-24.3-04`: the type's own fields, such as a bug's severity and steps. */
  attributes: Record<string, unknown>;
  createdBy: string;
  /** The request the work is for (D312). */
  requestId?: string | null;
  /** Where the item came from. `Manual` unless something else raised it. */
  origin?: { type: string; id: string | null; detailEn: string; detailAr: string };
};

/** Creates a work item and its "Created" activity row in one transaction. */
export async function insertWorkItem(input: NewWorkItem): Promise<string> {
  const prefix = input.type === "Bug" ? "BUG" : "TSK";
  const key = await nextKey(prefix);
  await db().transaction(async (tx) => {
    const [project] = await tx.select({ id: s.project.id }).from(s.project).where(eq(s.project.key, input.projectKey)).limit(1);
    if (!project) throw new Error(`No project ${input.projectKey}.`);
    const [parent] = input.parentKey
      ? await tx.select({ id: s.workItem.id }).from(s.workItem).where(eq(s.workItem.key, input.parentKey)).limit(1)
      : [undefined];

    const [created] = await tx
      .insert(s.workItem)
      .values({
        key,
        projectId: project.id,
        type: input.type,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionEn,
        status: input.status,
        priority: input.priority,
        assigneeType: input.assignee?.type ?? "None",
        assigneeId: input.assignee?.id ?? null,
        reviewerType: input.reviewerId ? "Person" : null,
        reviewerId: input.reviewerId,
        dueAt: input.dueAt,
        parentWorkItemId: parent?.id ?? null,
        requestId: input.requestId ?? null,
        originType: input.origin?.type ?? "Manual",
        originId: input.origin?.id ?? null,
        attributes: input.attributes,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      })
      .returning({ id: s.workItem.id });

    await tx.insert(s.workItemActivity).values({
      workItemId: created.id,
      actorType: "Person",
      actorId: input.createdBy,
      eventType: "Created",
      detailEn: input.origin?.detailEn ?? "created this work item",
      detailAr: input.origin?.detailAr ?? "أنشأ بند العمل",
    });
  });
  return key;
}

