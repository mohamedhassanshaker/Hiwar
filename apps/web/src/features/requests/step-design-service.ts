import { ApprovalRequired } from "@/lib/approval-binding";
import { NotPermitted, requireOrganisationPermission } from "@/lib/session";
import { fieldsIn, sensitiveFieldsIn, STEP_FIELD_RULES } from "./privileges";
import * as repository from "./repository";
import type {
  AudienceInput,
  DeleteStepInput,
  RuleInput,
  SetStepSlaInput,
  UpdateStepInput,
  SetStepTerminalInput,
  MoveStepInput,
  StepEntryInput,
  StepInput,
  UpdateRuleInput,
} from "./schema";
import { RequestTypeRejected } from "./errors";
import { draftOf } from "./request-type-service";

/** The step a designer change names, within the draft. */
async function stepOf(versionId: string, name: string): Promise<{ id: string; nameEn: string }> {
  const steps = await repository.stepsOfVersion(versionId);
  const step = steps.find((one) => one.nameEn === name);
  if (!step) throw new RequestTypeRejected(`No step named ${name}.`, `لا توجد خطوة باسم ${name}.`);
  return step;
}

/** `UC-30.2-01`: add a step to the draft's ordered list. */
export async function addStep(input: StepInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  const steps = await repository.stepsOfVersion(versionId);
  if (steps.some((step) => step.nameEn === input.nameEn)) {
    throw new RequestTypeRejected(
      `There is already a step named ${input.nameEn}.`,
      `توجد خطوة باسم ${input.nameEn} بالفعل.`,
    );
  }
  await repository.addStep(versionId, input.nameEn, input.nameAr, { value: input.slaValue, unit: input.slaUnit });
}

/**
 * What one edit changed: the fields it touched, as they were and as they are, and what
 * the change takes with it.
 *
 * The cascade is part of the diff because it is part of the change: marking a step
 * terminal discards its audiences and its outgoing rules, and an approver agreeing to
 * "isTerminal: true" is agreeing to that too. Naming them is what makes the approval
 * informed rather than nominal.
 */
export type StepDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** What this edit removes besides the fields themselves. */
  cascade: { audiences: string[]; rules: string[] };
  version: number;
};

/**
 * `UC-30.2`: edit one step as a patch — the one write path for a step.
 *
 * All of it or none: the privileges are checked over every field first, so a patch that
 * names one field the person may not change does not half-apply. The console's narrow
 * actions are wrappers over this, so a step is changed the same way whoever asks.
 *
 * @throws {NotPermitted} naming the field and the privilege it needs.
 * @throws {RequestTypeRejected} when the step is gone, or somebody saved it since the
 * caller read it — the caller reads again and retries rather than overwriting.
 */
export async function updateStep(input: UpdateStepInput): Promise<StepDiff> {
  const session = await requireOrganisationPermission("request_types:write");

  // Every privilege the patch needs, organisation-wide, before anything is written (the draft
  // included). This applies to whoever asks: an agent holds exactly the permissions of the
  // person it acts for.
  for (const field of fieldsIn(input)) {
    const needed = STEP_FIELD_RULES[field].privilege;
    await requireOrganisationPermission(needed).catch((problem: unknown) => {
      throw problem instanceof NotPermitted ? new NotPermitted(needed, `user_permission: ${field} needs ${needed}.`) : problem;
    });
  }
  const versionId = await draftOf(input.code);

  // A sensitive field set by an agent waits for a person. Refused before anything is
  // written, so the call that comes back after an approval is the first one to change
  // anything — which is what makes the harness's retry safe. A person in the console is
  // already the decision and is unaffected.
  const sensitive = sensitiveFieldsIn(input);
  // Unless a person has already agreed to exactly these fields, which the MCP boundary
  // establishes by spending a bound approval before the call reaches here (D20, D49).
  const unapproved = sensitive.filter((field) => !session.approvedFields.includes(field));
  if (session.actingAgent && unapproved.length > 0) {
    throw new ApprovalRequired({
      tool: "request_type_step_edit",
      // Filled in at the MCP boundary, which is where the wire arguments are.
      argumentsHash: "",
      fields: unapproved,
      expectedVersion: input.expectedVersion,
      reasons: unapproved.map((field) => STEP_FIELD_RULES[field].reason ?? ""),
    });
  }

  const before = await repository.readStep(versionId, input.stepName);
  if (!before) {
    throw new RequestTypeRejected(
      `There is no step ${input.stepName}.`,
      `لا توجد خطوة ${input.stepName}.`,
    );
  }

  const step = await stepOf(versionId, input.stepName);
  // Read before the write: once the update has run they are gone, and the diff has to
  // say what went with it.
  const cascade =
    input.isTerminal === true
      ? await repository.stepCascade(step.id)
      : { audiences: [], rules: [] };
  const patch = Object.fromEntries(fieldsIn(input).map((field) => [field, input[field]]));
  const written = await repository.updateStep(step.id, input.expectedVersion, patch, session.personId);
  if (!written) {
    throw new RequestTypeRejected(
      `That step was version ${before.version}, not ${input.expectedVersion}. Read it again and retry.`,
      `كانت هذه الخطوة بالإصدار ${before.version} وليس ${input.expectedVersion}. أعد قراءتها ثم حاول مجدداً.`,
    );
  }

  const touched = fieldsIn(input);
  return {
    before: Object.fromEntries(touched.map((field) => [field, before[field]])),
    after: patch,
    cascade,
    version: input.expectedVersion + 1,
  };
}

/**
 * `UC-30.1-01`: a step's SLA.
 *
 * Both halves move together: a count without an interval, or an interval without a count,
 * is not a duration, so either both are set or the step has no SLA.
 */
export async function setStepSla(input: SetStepSlaInput): Promise<void> {
  if ((input.slaValue === null) !== (input.slaUnit === null)) {
    throw new RequestTypeRejected(
      "An SLA needs both a number and an interval.",
      "تحتاج اتفاقية الخدمة إلى رقم ووحدة زمنية معاً.",
    );
  }
  // One write path: the console's narrow action and the agent's patch are the same edit,
  // so a step cannot be changed two different ways with two different sets of checks.
  const versionId = await draftOf(input.code);
  const current = await repository.readStep(versionId, input.stepName);
  if (!current) {
    throw new RequestTypeRejected(
      `There is no step ${input.stepName}.`,
      `لا توجد خطوة ${input.stepName}.`,
    );
  }
  await updateStep({
    code: input.code,
    stepName: input.stepName,
    expectedVersion: current.version,
    slaValue: input.slaValue,
    slaUnit: input.slaUnit,
  });
}

/** `UC-30.2-04`: mark a step terminal, which clears what a terminal step may not have. */
export async function setStepTerminal(input: SetStepTerminalInput): Promise<void> {
  const versionId = await draftOf(input.code);
  const current = await repository.readStep(versionId, input.stepName);
  if (!current) {
    throw new RequestTypeRejected(
      `There is no step ${input.stepName}.`,
      `لا توجد خطوة ${input.stepName}.`,
    );
  }
  await updateStep({
    code: input.code,
    stepName: input.stepName,
    expectedVersion: current.version,
    isTerminal: input.terminal,
    terminalOutcome: input.terminal ? input.outcome : "Completed",
  });
}

/** `UC-30.2-01`: move a step within the draft, the console's narrow wrapper over the step edit. */
export async function moveStep(input: MoveStepInput): Promise<void> {
  const versionId = await draftOf(input.code);
  const current = await repository.readStep(versionId, input.stepName);
  if (!current) {
    throw new RequestTypeRejected(
      `There is no step ${input.stepName}.`,
      `لا توجد خطوة ${input.stepName}.`,
    );
  }
  if (current.position === input.position) return;
  await updateStep({
    code: input.code,
    stepName: input.stepName,
    expectedVersion: current.version,
    position: input.position,
  });
}

/** What deleting a step would break, or what deleting it did. */
export type StepRemoval = { removed: boolean; referencedBy: string[] };

/**
 * `UC-30.2-09`: delete a step, naming the rules that point at it first.
 *
 * A rule whose target is gone routes nowhere, and a request that reaches it stops. The
 * rules are listed before anything is deleted so the person decides knowing that.
 */
export async function deleteStep(input: DeleteStepInput): Promise<StepRemoval> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  const step = await stepOf(versionId, input.stepName);

  const pointing = await repository.rulesPointingAt(step.id);
  const referencedBy = pointing.map((rule) => `${rule.fromStep}: ${rule.expression ?? rule.actionName ?? ""}`.trim());
  if (referencedBy.length > 0 && !input.confirmed) return { removed: false, referencedBy };

  await repository.deleteStep(step.id);
  return { removed: true, referencedBy };
}

/** `UC-30.2-02`: an audience on a step, with what it may do there. */
export async function addAudience(input: AudienceInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  const step = await stepOf(versionId, input.stepName);
  // The audience row stores the agent's id, which is what `agentAudiencesOf` joins on at
  // run time. The console picks an agent by its code, because that is what the agent
  // directory carries; a caller that already holds the id passes that. Both are accepted,
  // so neither has to know which the other uses.
  let principalId = input.principalId;
  if (input.principalType === "Agent" && principalId !== null) {
    const agentId = await repository.agentIdOf(principalId);
    if (!agentId) throw new RequestTypeRejected(`There is no agent ${principalId}.`, `لا يوجد وكيل ${principalId}.`);
    principalId = agentId;
  }
  // A role, group or person given by name is taken the same way; one that names nobody is
  // refused here rather than reaching the database as an id it is not.
  if ((input.principalType === "Person" || input.principalType === "Group" || input.principalType === "Role") && principalId !== null) {
    const found = await repository.principalIdOf(input.principalType, principalId);
    if (!found) {
      const kind = input.principalType.toLowerCase();
      throw new RequestTypeRejected(
        `There is no ${kind} ${principalId}. Give its id, or its ${input.principalType === "Person" ? "email" : "code or name"}.`,
        `لا يوجد ${kind === "person" ? "شخص" : kind === "group" ? "مجموعة" : "دور"} ${principalId}. أعطِ معرّفه أو ${input.principalType === "Person" ? "بريده الإلكتروني" : "رمزه أو اسمه"}.`,
      );
    }
    principalId = found;
  }
  await repository.addAudience(step.id, {
    principalType: input.principalType,
    principalId,
    access: input.access,
    sequence: input.sequence,
  });
}

/** `UC-30.2-03` and `-10`: a routing rule out of a step. A rule may point backwards. */
export async function addRule(input: RuleInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  const step = await stepOf(versionId, input.stepName);
  if (input.kind === "Condition" && !input.expression) {
    throw new RequestTypeRejected("A condition rule needs a condition.", "قاعدة الشرط تحتاج إلى شرط.");
  }
  if (input.kind === "Action" && !input.actionName) {
    throw new RequestTypeRejected("An action rule needs an action.", "قاعدة الإجراء تحتاج إلى إجراء.");
  }
  if (input.toStepName) await stepOf(versionId, input.toStepName);
  await repository.addRule(
    step.id,
    { kind: input.kind, expression: input.expression, actionName: input.actionName, toStepName: input.toStepName },
    versionId,
  );
}

/**
 * D309: change a routing rule of a draft step in place, keeping its place in the order rules
 * are tried. The fields named replace the stored ones; the result is checked as a new rule is.
 */
export async function updateRule(input: UpdateRuleInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const versionId = await draftOf(input.code);
  const step = await stepOf(versionId, input.stepName);
  const before = await repository.ruleAt(step.id, input.position);
  if (!before) {
    throw new RequestTypeRejected(`Step ${input.stepName} has no rule ${input.position}.`, `لا توجد قاعدة رقم ${input.position} في الخطوة ${input.stepName}.`);
  }
  const rule = {
    kind: input.kind ?? before.kind,
    expression: input.expression !== undefined ? input.expression : before.expression,
    actionName: input.actionName !== undefined ? input.actionName : before.actionName,
  };
  if (rule.kind === "Condition" && !rule.expression) {
    throw new RequestTypeRejected("A condition rule needs a condition.", "قاعدة الشرط تحتاج إلى شرط.");
  }
  if (rule.kind === "Action" && !rule.actionName) {
    throw new RequestTypeRejected("An action rule needs an action.", "قاعدة الإجراء تحتاج إلى إجراء.");
  }
  const toStepId =
    input.toStepName === undefined ? undefined : input.toStepName === null ? null : (await stepOf(versionId, input.toStepName)).id;
  await repository.updateRule(before.id, { ...rule, ...(toStepId === undefined ? {} : { toStepId }) });
}

/** `UC-30.2-02`: take an audience off a draft step, by its position in the step's list. */
export async function removeAudience(input: StepEntryInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const step = await stepOf(await draftOf(input.code), input.stepName);
  if (!(await repository.removeAudienceAt(step.id, input.position))) {
    throw new RequestTypeRejected(`Step ${input.stepName} has no audience ${input.position}.`, `لا يوجد جمهور رقم ${input.position} في الخطوة ${input.stepName}.`);
  }
}

/** `UC-30.2-03`: take a routing rule off a draft step, by its position in the order rules are tried. */
export async function removeRule(input: StepEntryInput): Promise<void> {
  await requireOrganisationPermission("request_types:write");
  const step = await stepOf(await draftOf(input.code), input.stepName);
  if (!(await repository.removeRuleAt(step.id, input.position))) {
    throw new RequestTypeRejected(`Step ${input.stepName} has no rule ${input.position}.`, `لا توجد قاعدة رقم ${input.position} في الخطوة ${input.stepName}.`);
  }
}
