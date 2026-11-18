import { ApprovalRequired } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { Rejected } from "@/lib/rejection";
import { NotPermitted, can, requirePermission } from "@/lib/session";
import { ORG_UNIT_FIELD_RULES, fieldsIn, sensitiveFieldsIn } from "./privileges";
import * as repository from "./repository";
import type { UpdateOrgUnitInput } from "./schema";

/** One unit's history, as the audit log recorded it. */
export async function orgUnitHistory(code: string) {
  await requirePermission("organisation:read");
  return repository.orgUnitHistory(code);
}

/** Raised when a unit cannot be created or removed, carrying a message for the screen. */
export class OrgUnitError extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "OrgUnitError";
  }
}

/**
 * `UC-42.1-02`: create a unit. `UC-42.1-03` rejects a duplicate code or a parent that would
 * make a cycle.
 *
 * The code is unique by index, so the database is what actually enforces it; the check here
 * turns that into a message a person can act on rather than a constraint violation. The
 * cycle check has no database equivalent — a self-referencing foreign key cannot express
 * "the ancestors must terminate" — so it is walked here before the insert.
 *
 * @throws {OrgUnitError} when the code is taken or the parent does not exist.
 */
export async function createOrgUnit(input: {
  code: string;
  nameEn: string;
  nameAr: string;
  parentOrgUnitId: string | null;
  leadPersonId: string | null;
}): Promise<string> {
  const session = await requirePermission("organisation:write");

  const existing = await repository.orgUnitOptions();
  if (existing.some((unit) => unit.code.toLowerCase() === input.code.toLowerCase())) {
    throw new OrgUnitError("Code already in use.", "الرمز مستخدم بالفعل.");
  }
  if (input.parentOrgUnitId && !existing.some((unit) => unit.id === input.parentOrgUnitId)) {
    throw new OrgUnitError("That parent org unit no longer exists.", "لم تعد الوحدة الأم موجودة.");
  }

  const id = await repository.insertOrgUnit({ ...input, personId: session.personId });
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "org_unit:create",
    objectType: "OrgUnit",
    objectLabel: input.code,
    detail: { parentOrgUnitId: input.parentOrgUnitId },
  });
  return id;
}

/**
 * What one edit changed: the fields it touched, as they were and as they are, and what
 * moves with the change.
 *
 * Re-parenting a unit is not a change to the unit alone — everyone in it, every agent and
 * project attached to it and every unit under it moves with it, and the role grants scoped
 * to it follow. The cascade names how many, so an approver reads the real size of the move.
 */
export type OrgUnitDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** What moves with the unit when its parent changes. */
  cascade: { people: number; agents: number; projects: number; children: number };
  version: number;
};

/**
 * `UC-42.1`: edit one org unit as a patch — the one write path for a unit.
 *
 * `UC-42.1-03`'s cycle rule applies to a move as much as to a creation, and for the same
 * reason as `changeReportingLine`: the chart is drawn from the root down, so a detached
 * cycle is not drawn at all and every unit inside it silently disappears.
 *
 * @throws {NotPermitted} naming the field and the privilege it needs.
 * @throws {ApprovalRequired} when an agent names a field a person has not agreed to.
 * @throws {OrgUnitError} when the unit or the parent is gone, the move would make a loop,
 * or somebody saved it since the caller read it.
 */
export async function updateOrgUnit(input: UpdateOrgUnitInput): Promise<OrgUnitDiff> {
  const session = await requirePermission("organisation:write");

  // Every privilege the patch needs, before anything is written. This applies to whoever
  // asks: an agent holds exactly the permissions of the person it acts for.
  for (const field of fieldsIn(input)) {
    const needed = ORG_UNIT_FIELD_RULES[field].privilege;
    if (!(await can(needed))) {
      throw new NotPermitted(needed, `user_permission: ${field} needs ${needed}.`);
    }
  }

  // A sensitive field set by an agent waits for a person, unless one has already agreed to
  // exactly these fields — which the MCP boundary establishes by spending a bound approval
  // before the call reaches here (D20, D49). Refused before anything is written.
  const unapproved = sensitiveFieldsIn(input).filter((field) => !session.approvedFields.includes(field));
  if (session.actingAgent && unapproved.length > 0) {
    throw new ApprovalRequired({
      tool: "org_unit_edit",
      // Filled in at the MCP boundary, which is where the wire arguments are.
      argumentsHash: "",
      fields: unapproved,
      expectedVersion: input.expectedVersion,
      reasons: unapproved.map((field) => ORG_UNIT_FIELD_RULES[field].reason ?? ""),
    });
  }

  const unit = await repository.readOrgUnit(input.id);
  if (!unit) throw new OrgUnitError("That org unit no longer exists.", "لم تعد هذه الوحدة موجودة.");

  if (input.parentOrgUnitId) {
    const parents = new Map(
      (await repository.orgUnitParents()).map((row) => [row.id, row.parentOrgUnitId]),
    );
    if (!parents.has(input.parentOrgUnitId)) {
      throw new OrgUnitError("That parent org unit no longer exists.", "لم تعد الوحدة الأم موجودة.");
    }
    // Walk up from the proposed parent: if this unit is already above it, the new edge
    // points back into its own branch. A cycle already in the data must not hang the walk.
    const seen = new Set<string>();
    let cursor: string | null = input.parentOrgUnitId;
    while (cursor) {
      if (cursor === input.id || seen.has(cursor)) {
        throw new OrgUnitError(
          "This would put the org unit under itself.",
          "هذا يضع الوحدة التنظيمية تحت نفسها.",
        );
      }
      seen.add(cursor);
      cursor = parents.get(cursor) ?? null;
    }
  }

  // Read before the write, because the move is what the counts describe.
  const contents = await repository.orgUnitContents(input.id);
  const written = await repository.updateOrgUnit(
    input.id,
    input.expectedVersion,
    {
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      parentOrgUnitId: input.parentOrgUnitId,
      leadPersonId: input.leadPersonId,
    },
    session.personId,
  );
  if (!written) {
    throw new OrgUnitError(
      `That org unit was version ${unit.version}, not ${input.expectedVersion}. Read it again and retry.`,
      `كانت هذه الوحدة بالإصدار ${unit.version} وليس ${input.expectedVersion}. أعد قراءتها ثم حاول مجدداً.`,
    );
  }

  const was: Record<string, unknown> = {
    nameEn: unit.nameEn,
    nameAr: unit.nameAr,
    parentOrgUnitId: unit.parentOrgUnitId,
    leadPersonId: unit.leadPersonId,
  };
  const touched = fieldsIn(input);
  const diff: OrgUnitDiff = {
    before: Object.fromEntries(touched.map((field) => [field, was[field]])),
    after: Object.fromEntries(touched.map((field) => [field, input[field]])),
    cascade: "parentOrgUnitId" in input ? contents : { people: 0, agents: 0, projects: 0, children: 0 },
    version: input.expectedVersion + 1,
  };

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "org_unit:update",
    objectType: "OrgUnit",
    objectId: input.id,
    objectLabel: unit.code,
    detail: { before: diff.before, after: diff.after, cascade: diff.cascade },
  });
  return diff;
}

/**
 * `UC-42.1-04`: removing a unit that still holds people, agents, projects or child units is
 * refused, with what is in the way.
 *
 * @throws {OrgUnitError} when anything still points at the unit.
 */
export async function removeOrgUnit(orgUnitId: string, code: string): Promise<void> {
  const session = await requirePermission("organisation:write");

  const contents = await repository.orgUnitContents(orgUnitId);
  const blocking = [
    contents.people && `${contents.people} people`,
    contents.agents && `${contents.agents} agents`,
    contents.projects && `${contents.projects} projects`,
    contents.children && `${contents.children} child org units`,
  ].filter(Boolean);
  const blockingAr = [
    contents.people && `${contents.people} أشخاص`,
    contents.agents && `${contents.agents} وكلاء`,
    contents.projects && `${contents.projects} مشاريع`,
    contents.children && `${contents.children} وحدات فرعية`,
  ].filter(Boolean);

  if (blocking.length) {
    throw new OrgUnitError(
      `Move members and projects first: this org unit still has ${blocking.join(", ")}.`,
      `انقل الأعضاء والمشاريع أولاً: لا تزال هذه الوحدة تضم ${blockingAr.join("، ")}.`,
    );
  }

  await repository.deleteOrgUnit(orgUnitId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "org_unit:delete",
    objectType: "OrgUnit",
    objectLabel: code,
  });
}
