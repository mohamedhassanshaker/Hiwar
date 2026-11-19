import { ApprovalRequired } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { NotPermitted, can, requirePermission } from "@/lib/session";
import { BUDGET_FIELD_RULES, fieldsIn, sensitiveFieldsIn } from "./privileges";
import * as repository from "./repository";
import type { CreateBudgetInput, SaveBudgetInput, UpdateBudgetInput } from "./schema";
import { BudgetRejected } from "./errors";

/**
 * `UC-71.1-03` … `-07`: the console's one-form save, as a thin wrapper over the two
 * write paths below. With an id it is an edit; without one it is a new window.
 */
export async function saveBudget(input: SaveBudgetInput): Promise<void> {
  if (!input.budgetId) {
    await createBudget(input);
    return;
  }
  const current = await repository.readBudget(input.budgetId);
  if (!current) throw new BudgetRejected("That budget no longer exists.", "لم تعد هذه الميزانية موجودة.");
  await updateBudget({
    budgetId: input.budgetId,
    expectedVersion: current.version,
    limitAed: input.limitAed,
    period: input.period,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    warnAtPct: input.warnAtPct,
    actionAt100: input.actionAt100,
    cheaperRouteAlias: input.cheaperRouteAlias,
  });
}

/**
 * The window a patch describes, and the route id its action needs.
 *
 * `UC-71.1-06`: a window that ends before it starts is not a window. `UC-71.1-05`: falling
 * to a cheaper alias needs an alias to fall to. `UC-71.1-07`: two windows for one agent in
 * force at the same moment is not a limit, so an overlap is refused naming the one it hits.
 *
 * @throws {BudgetRejected} when any of the three fails.
 */
async function resolveWindow(values: {
  agentCode: string;
  limitAed: number;
  period: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  warnAtPct: number;
  actionAt100: string;
  cheaperRouteAlias?: string | null;
  exceptId?: string;
}): Promise<{ cheaperRouteId: string | null }> {
  const from = new Date(`${values.effectiveFrom}T00:00:00Z`);
  const to = values.effectiveTo ? new Date(`${values.effectiveTo}T00:00:00Z`) : null;
  if (to && to <= from) {
    throw new BudgetRejected(
      "Effective to must be after effective from.",
      "تاريخ السريان إلى يجب أن يلي تاريخ السريان من.",
    );
  }

  let cheaperRouteId: string | null = null;
  if (values.actionAt100 === "SwitchToCheaperAlias") {
    if (!values.cheaperRouteAlias) {
      throw new BudgetRejected("Choose the route to switch to.", "اختر المسار الذي تريد التحويل إليه.");
    }
    cheaperRouteId = await repository.routeIdByAlias(values.cheaperRouteAlias);
    if (!cheaperRouteId) throw new BudgetRejected("That route no longer exists.", "لم يعد هذا المسار موجوداً.");
  }

  const clash = await repository.overlappingBudget({
    agentCode: values.agentCode,
    from,
    to,
    exceptId: values.exceptId,
  });
  if (clash) {
    throw new BudgetRejected(
      `This overlaps the budget from ${clash.from} to ${clash.to ?? "no end date"}.`,
      `يتداخل هذا مع الميزانية من ${clash.from} إلى ${clash.to ?? "بلا تاريخ انتهاء"}.`,
      { from: clash.from, to: clash.to },
    );
  }
  return { cheaperRouteId };
}

/** `UC-71.1-03`: a new budget window for an agent. Returns its id. */
export async function createBudget(input: CreateBudgetInput): Promise<string> {
  const session = await requirePermission("budgets:write");
  const { cheaperRouteId } = await resolveWindow(input);
  const budgetId = await repository.insertBudget({ ...input, cheaperRouteId }, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "budgets:write",
    objectType: "AgentBudget",
    objectId: budgetId,
    objectLabel: input.agentCode,
    detail: { created: true, limitAed: input.limitAed, period: input.period, actionAt100: input.actionAt100 },
  });
  return budgetId;
}

/**
 * What one budget edit changed: the fields it touched, as they were and as they are, and
 * what the change takes with it.
 *
 * The cascade is part of the diff because it is part of the change: moving the window off
 * today leaves the agent spending against no limit, and taking the action off `PauseAgent`
 * removes the stop that reaching the limit used to be. The first is read after the write
 * from the same function the spend accounting uses, so the diff says what is actually in
 * force rather than what the patch intended.
 */
export type BudgetDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  cascade: { noLimitInForce: boolean; stopRemoved: string | null };
  version: number;
};

/**
 * `UC-71.1-04`: edit one budget window as a patch — the one write path for a budget.
 *
 * All of it or none: the privileges are checked over every field first, so a patch that
 * names one field the person may not change does not half-apply. The window, the limit
 * and the action are validated together against the stored row, because each of the three
 * rules reads more than one field.
 *
 * @throws {NotPermitted} naming the field and the privilege it needs.
 * @throws {ApprovalRequired} when an agent names a field a person has not agreed to.
 * @throws {BudgetRejected} when the window is gone, the patch is not a usable window, or
 * somebody saved it since the caller read it.
 */
export async function updateBudget(input: UpdateBudgetInput): Promise<BudgetDiff> {
  const session = await requirePermission("budgets:write");

  for (const field of fieldsIn(input)) {
    const needed = BUDGET_FIELD_RULES[field].privilege;
    if (!(await can(needed))) {
      throw new NotPermitted(needed, `user_permission: ${field} needs ${needed}.`);
    }
  }

  // A sensitive field set by an agent waits for a person, unless one has already agreed to
  // exactly these fields (D20, D49). An agent lifting its own ceiling is the case this is
  // here for. Refused before anything is written.
  const unapproved = sensitiveFieldsIn(input).filter((field) => !session.approvedFields.includes(field));
  if (session.actingAgent && unapproved.length > 0) {
    throw new ApprovalRequired({
      tool: "budget_edit",
      argumentsHash: "",
      fields: unapproved,
      expectedVersion: input.expectedVersion,
      reasons: unapproved.map((field) => BUDGET_FIELD_RULES[field].reason ?? ""),
    });
  }

  const current = await repository.readBudget(input.budgetId);
  if (!current) throw new BudgetRejected("That budget no longer exists.", "لم تعد هذه الميزانية موجودة.");

  const merged = {
    agentCode: current.agentCode,
    limitAed: input.limitAed ?? current.limitAed,
    period: input.period ?? current.period,
    effectiveFrom: input.effectiveFrom ?? current.effectiveFrom,
    effectiveTo: input.effectiveTo === undefined ? current.effectiveTo : input.effectiveTo,
    warnAtPct: input.warnAtPct ?? current.warnAtPct,
    actionAt100: input.actionAt100 ?? current.actionAt100,
    cheaperRouteAlias:
      input.cheaperRouteAlias === undefined ? current.cheaperRouteAlias : input.cheaperRouteAlias,
  };
  const { cheaperRouteId } = await resolveWindow({ ...merged, exceptId: input.budgetId });

  const written = await repository.updateBudget(
    input.budgetId,
    input.expectedVersion,
    { ...merged, cheaperRouteId },
    session.personId,
  );
  if (!written) {
    throw new BudgetRejected(
      `That budget was version ${current.version}, not ${input.expectedVersion}. Read it again and retry.`,
      `كانت هذه الميزانية بالإصدار ${current.version} وليس ${input.expectedVersion}. أعد قراءتها ثم حاول مجدداً.`,
    );
  }

  const inForce = await repository.budgetInForce(current.agentId, new Date());
  const cascade = {
    noLimitInForce: inForce === null,
    stopRemoved:
      current.actionAt100 === "PauseAgent" && merged.actionAt100 !== "PauseAgent" ? "PauseAgent" : null,
  };

  const was: Record<string, unknown> = current;
  const after: Record<string, unknown> = merged;
  const touched = fieldsIn(input);
  const diff: BudgetDiff = {
    before: Object.fromEntries(touched.map((field) => [field, was[field]])),
    after: Object.fromEntries(touched.map((field) => [field, after[field]])),
    cascade,
    version: input.expectedVersion + 1,
  };

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "budgets:write",
    objectType: "AgentBudget",
    objectId: input.budgetId,
    objectLabel: current.agentCode,
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
