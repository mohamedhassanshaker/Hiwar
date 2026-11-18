import { ApprovalRequired } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { NotPermitted, can, requirePermission, requireProjectPermission } from "@/lib/session";
import { FILE_FIELD_RULES, fieldsIn, sensitiveFieldsIn } from "./privileges";
import * as repository from "./repository";
import type { SetFileStatusInput, SetScopeOfUseInput, UpdateFileInput } from "./schema";
import { FileRejected } from "./errors";

/** The console's Deactivate, as a thin wrapper over the one write path. */
export async function setFileStatus(input: SetFileStatusInput): Promise<void> {
  const current = await repository.readItem(input.name, input.kind);
  if (!current) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  await updateFile({
    name: input.name,
    kind: input.kind,
    expectedVersion: current.version,
    active: input.active,
  });
}

/**
 * What one edit changed: the fields it touched, as they were and as they are, and what
 * the change takes with it.
 *
 * The cascade is part of the diff because it is part of the change: the grants are
 * replaced whole, so naming a shorter list takes the people and agents left out off the
 * file. An approver agreeing to the patch is agreeing to that too.
 */
export type FileDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** The principals this edit takes off the file. */
  cascade: { grantsRemoved: string[] };
  version: number;
};

/**
 * Edit one artifact or project file as a patch — the one write path for a stored item.
 *
 * All of it or none: the privileges are checked over every field first, so a patch that
 * names one field the person may not change does not half-apply.
 *
 * Requires `files:write` in the item's project.
 *
 * @throws {NotPermitted} naming the field and the privilege it needs.
 * @throws {ApprovalRequired} when an agent names a field a person has not agreed to.
 * @throws {FileRejected} when the item is gone, or somebody saved it since it was read.
 */
export async function updateFile(input: UpdateFileInput): Promise<FileDiff> {
  const session = await requirePermission("files:write");

  for (const field of fieldsIn(input)) {
    const needed = FILE_FIELD_RULES[field].privilege;
    if (!(await can(needed))) {
      throw new NotPermitted(needed, `user_permission: ${field} needs ${needed}.`);
    }
  }

  // The scope of use and its grants are not in the agent's own patch schema, so this can
  // only be reached by an agent calling the service directly. Refused before anything is
  // written, the same as every other sensitive field (D49).
  const unapproved = sensitiveFieldsIn(input).filter((field) => !session.approvedFields.includes(field));
  if (session.actingAgent && unapproved.length > 0) {
    throw new ApprovalRequired({
      tool: "file_edit",
      argumentsHash: "",
      fields: unapproved,
      expectedVersion: input.expectedVersion,
      reasons: unapproved.map((field) => FILE_FIELD_RULES[field].reason ?? ""),
    });
  }

  const current = await repository.readItem(input.name, input.kind);
  if (!current) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  await requireProjectPermission("files:write", current.projectId);
  // `UC-33.1-07`: who may read a file is its owner's to change. Without this, anybody holding
  // `files:write` could widen somebody else's Only-me file and then read it.
  if ((input.scopeOfUse !== undefined || input.grants !== undefined) && current.uploadedBy !== session.personId) {
    throw new NotPermitted("files:write", `user_permission: only the person who uploaded ${input.name} may change who can read it.`);
  }

  // Read before the write: once the grants are replaced the dropped principals are gone,
  // and the diff still has to say who they were.
  const cascade = {
    grantsRemoved: input.grants ? current.grants.filter((grant) => !input.grants?.includes(grant)) : [],
  };

  const written = await repository.updateItem(
    current.id,
    input.kind,
    input.expectedVersion,
    { active: input.active, scopeOfUse: input.scopeOfUse, grants: input.grants },
    session.personId,
  );
  if (!written) {
    throw new FileRejected(
      `That item was version ${current.version}, not ${input.expectedVersion}. Read it again and retry.`,
      `كان هذا البند بالإصدار ${current.version} وليس ${input.expectedVersion}. أعد قراءته ثم حاول مجدداً.`,
    );
  }

  const was: Record<string, unknown> = {
    active: current.status === "Active",
    scopeOfUse: current.scopeOfUse,
    grants: current.grants,
  };
  const touched = fieldsIn(input);
  const diff: FileDiff = {
    before: Object.fromEntries(touched.map((field) => [field, was[field]])),
    after: Object.fromEntries(touched.map((field) => [field, input[field]])),
    cascade,
    version: input.expectedVersion + 1,
  };

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "files:write",
    objectType: input.kind === "artifact" ? "Artifact" : "ProjectFile",
    objectId: current.id,
    objectLabel: input.name,
    detail: {
      ...Object.fromEntries(
        touched.flatMap((field) => [
          [`${field}From`, diff.before[field]],
          [`${field}To`, diff.after[field]],
        ]),
      ),
      cascade,
    },
  });
  return diff;
}

/** `UC-32.1-05`: delete an artifact or a file, with `files:write` in its project. The audit record of it stays. */
export async function deleteItem(input: SetFileStatusInput): Promise<void> {
  const session = await requirePermission("files:write");
  const item = await repository.projectOf(input.name, input.kind);
  if (!item) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  await requireProjectPermission("files:write", item.projectId);

  const removed = await repository.deleteItem(item.id, input.kind);
  if (!removed) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "files:delete",
    objectType: input.kind === "artifact" ? "Artifact" : "ProjectFile",
    objectLabel: input.name,
    detail: { project: item.key },
  });
}

/** The console's scope-of-use save, as a thin wrapper over the one write path. */
export async function setScopeOfUse(input: SetScopeOfUseInput): Promise<void> {
  const current = await repository.readItem(input.name, "file");
  if (!current) throw new FileRejected("That item no longer exists.", "لم يعد هذا البند موجوداً.");
  await updateFile({
    name: input.name,
    kind: "file",
    expectedVersion: current.version,
    scopeOfUse: input.scope,
    grants: input.grants,
  });
}
