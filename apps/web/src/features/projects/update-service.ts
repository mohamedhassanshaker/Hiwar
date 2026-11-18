import { ApprovalRequired } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { NotPermitted, can, requirePermission, requireProjectPermission, visibleProjectIds } from "@/lib/session";
import { PROJECT_FIELD_RULES, fieldsIn, sensitiveFieldsIn } from "./privileges";
import * as repository from "./repository";
import type { RenameProjectInput, UpdateProjectInput, UpdateProjectPolicyInput } from "./schema";
import { ProjectRejected } from "./errors";

/** Tiers in order, so "may only raise" is a comparison rather than a table of cases. */
const TIER_ORDER = ["T0", "T1", "T2", "T3"];

/**
 * What one edit changed: the fields it touched, as they were and as they are, and what
 * the change takes with it.
 *
 * The cascade is part of the diff because it is part of the change: each of the three
 * policy lists is replaced whole, so naming a shorter one drops the entries left out —
 * an allowed agent that may no longer be given work, or an approval rule that was the
 * human gate on an action. An approver agreeing to the patch is agreeing to those too.
 */
export type ProjectDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** What this edit removes besides the fields themselves. */
  cascade: { connectors: string[]; agents: string[]; approvalRules: string[] };
  version: number;
};

/**
 * `UC-21.2`: edit one project as a patch — the one write path for a project.
 *
 * All of it or none: the privileges are checked over every field first, so a patch that
 * names one field the person may not change does not half-apply. Sensitivity is set here
 * and nowhere else, because a room, a file and an artifact take the sensitivity of the
 * project they belong to, so raising it raises theirs in the same act rather than leaving
 * a copy of the old value behind on each one.
 *
 * @throws {NotPermitted} naming the field and the privilege it needs.
 * @throws {ApprovalRequired} when an agent names a field a person has not agreed to.
 * @throws {ProjectRejected} when the project is gone, the patch names something that is
 * not there, or somebody saved it since the caller read it.
 */
export async function updateProject(input: UpdateProjectInput): Promise<ProjectDiff> {
  await requirePermission("projects:write");
  const project = await repository.readProjectForPolicy(input.key);
  if (!project) throw new ProjectRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  // In this project's scope, not the person's own unit (`UC-41.2-03`).
  const session = await requireProjectPermission("projects:write", project.id);

  // Every privilege the patch needs, in this project, before anything is written. This applies
  // to whoever asks: an agent holds exactly the permissions of the person it acts for.
  for (const field of fieldsIn(input)) {
    const needed = PROJECT_FIELD_RULES[field].privilege;
    const reachable = await visibleProjectIds(needed);
    if (!(await can(needed)) || (reachable !== null && !reachable.includes(project.id))) {
      throw new NotPermitted(needed, `user_permission: ${field} needs ${needed}.`);
    }
  }

  // A sensitive field set by an agent waits for a person, unless one has already agreed to
  // exactly these fields — which the MCP boundary establishes by spending a bound approval
  // before the call reaches here (D20, D49). Refused before anything is written, so the
  // call that comes back after an approval is the first one to change anything.
  const unapproved = sensitiveFieldsIn(input).filter((field) => !session.approvedFields.includes(field));
  if (session.actingAgent && unapproved.length > 0) {
    throw new ApprovalRequired({
      tool: "project_edit",
      // Filled in at the MCP boundary, which is where the wire arguments are.
      argumentsHash: "",
      fields: unapproved,
      expectedVersion: input.expectedVersion,
      reasons: unapproved.map((field) => PROJECT_FIELD_RULES[field].reason ?? ""),
    });
  }

  const policy = await repository.readPolicy(project.id);

  // `UC-21.2-04`: a project may raise what a tool needs and never lower it. The floor is
  // where the connector declared the tool, which is the only place that knows what it does.
  const rules = input.approvalRules ?? [];
  const floors = await repository.declaredTiers(rules.map((rule) => rule.ref));
  for (const rule of rules) {
    const floor = floors[rule.ref];
    if (floor && TIER_ORDER.indexOf(rule.minimumTier) < TIER_ORDER.indexOf(floor)) {
      throw new ProjectRejected(
        `Project policies can only raise tiers. ${rule.ref} is ${floor} on its connector.`,
        `سياسات المشروع ترفع المستويات فقط. ${rule.ref} عند ${floor} على موصله.`,
      );
    }
  }

  const resolved = await repository.resolvePolicyCodes({
    connectors: input.allowedConnectors ?? [],
    agents: input.allowedAgents ?? [],
  });
  if (resolved.unknown.length > 0) {
    throw new ProjectRejected(
      `No such connector or agent: ${resolved.unknown.join(", ")}.`,
      `لا يوجد موصل أو وكيل بهذا المعرّف: ${resolved.unknown.join("، ")}.`,
    );
  }

  // Read before the write: once the lists have been replaced the dropped entries are gone,
  // and the diff still has to say what went with the edit.
  const cascade = {
    connectors: input.allowedConnectors
      ? policy.connectors.filter((code) => !input.allowedConnectors?.includes(code))
      : [],
    agents: input.allowedAgents ? policy.agents.filter((code) => !input.allowedAgents?.includes(code)) : [],
    approvalRules: input.approvalRules
      ? policy.approvalRules
          .filter((rule) => !input.approvalRules?.some((kept) => kept.ref === rule.ref))
          .map((rule) => `${rule.ref}:${rule.minimumTier}`)
      : [],
  };

  const written = await repository.updateProject(
    project.id,
    input.expectedVersion,
    {
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      sensitivity: input.sensitivity,
      status: input.status,
      requireReviewerNotAuthor: input.requireReviewerNotAuthor,
      ...(input.allowedConnectors ? { connectorIds: resolved.connectors.map((row) => row.id) } : {}),
      ...(input.allowedAgents ? { agentIds: resolved.agents.map((row) => row.id) } : {}),
      ...(input.approvalRules ? { approvalRules: input.approvalRules } : {}),
    },
    session.personId,
  );
  if (!written) {
    throw new ProjectRejected(
      `That project was version ${project.version}, not ${input.expectedVersion}. Read it again and retry.`,
      `كان هذا المشروع بالإصدار ${project.version} وليس ${input.expectedVersion}. أعد قراءته ثم حاول مجدداً.`,
    );
  }

  const current: Record<string, unknown> = {
    nameEn: project.nameEn,
    nameAr: project.nameAr,
    sensitivity: project.sensitivity,
    status: project.status,
    requireReviewerNotAuthor: project.requireReviewerNotAuthor,
    allowedConnectors: policy.connectors,
    allowedAgents: policy.agents,
    approvalRules: policy.approvalRules,
  };
  const touched = fieldsIn(input);
  const diff: ProjectDiff = {
    before: Object.fromEntries(touched.map((field) => [field, current[field]])),
    after: Object.fromEntries(touched.map((field) => [field, input[field]])),
    cascade,
    version: input.expectedVersion + 1,
  };

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "projects:write",
    objectType: "Project",
    objectId: project.id,
    objectLabel: input.key,
    // One pair per field the patch touched, so the log says what a value changed from as
    // well as what it changed to: a bulk edit's effects cannot be reconstructed otherwise.
    detail: { ...fromToOf(diff), cascade },
  });
  return diff;
}

/** A diff as the audit log reads it: `<field>From` and `<field>To` for each field touched. */
function fromToOf(diff: ProjectDiff): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(diff.after).flatMap((field) => [
      [`${field}From`, diff.before[field]],
      [`${field}To`, diff.after[field]],
    ]),
  );
}

/**
 * `UC-21.2-01` … `-06`: the project's policy, written as a whole.
 *
 * One write path: the console's whole-policy save and the agent's patch are the same edit,
 * so a project cannot be changed two different ways with two different sets of checks. The
 * screen does not carry a version, so the version it is saving against is read here.
 */
export async function updatePolicy(input: UpdateProjectPolicyInput): Promise<void> {
  const project = await repository.readProjectForPolicy(input.key);
  if (!project) throw new ProjectRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  await updateProject({
    key: input.key,
    expectedVersion: project.version,
    sensitivity: input.sensitivity,
    status: input.status,
    requireReviewerNotAuthor: input.requireReviewerNotAuthor,
    allowedConnectors: input.allowedConnectors,
    allowedAgents: input.allowedAgents,
    approvalRules: input.approvalRules,
  });
}

/** Renames a project. The key is its identity and is never affected. */
export async function renameProject(input: RenameProjectInput): Promise<void> {
  const project = await repository.readProjectForPolicy(input.key);
  if (!project) throw new ProjectRejected("That project no longer exists.", "لم يعد هذا المشروع موجوداً.");
  await updateProject({
    key: input.key,
    expectedVersion: project.version,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
  });
}
