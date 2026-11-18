import { audit } from "@/lib/audit";
import { Rejected } from "@/lib/rejection";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";

/** S-40: the org chart. */
export async function loadOrgChart() {
  await requirePermission("organisation:read");
  return repository.listOrgNodes();
}

/** Thrown by `changeReportingLine` when the move is refused. */
export class ReportingLineError extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "ReportingLineError";
  }
}

/**
 * `UC-40.2-01`: move a person or an agent under a new manager. `UC-40.2-02` refuses a move
 * that would make a reporting loop.
 *
 * Both are nodes of one hierarchy, so either may be the subject and either may be the
 * manager: an agent reporting to a person is the ordinary case, and a person reporting to
 * an agent is what an agent-run service desk is. The check therefore walks the combined
 * graph rather than the people in it.
 *
 * A loop here is worse than a wrong line. The chart renders from the root down, so a
 * detached cycle is not drawn at all: everyone inside it silently disappears from the
 * organisation rather than appearing in the wrong place.
 *
 * @param subjectNodeId Person row id, or agent code, as the chart identifies them.
 * @param managerNodeId The new manager, or null to put the subject at the top.
 * @throws {ReportingLineError} when either node is unknown, or the move would make a loop.
 */
export async function changeReportingLine(subjectNodeId: string, managerNodeId: string | null): Promise<void> {
  const session = await requirePermission("organisation:write");

  const subject = await repository.principalByNodeId(subjectNodeId);
  if (!subject) throw new ReportingLineError("That person or agent no longer exists.", "لم يعد هذا الشخص أو الوكيل موجوداً.");

  if (managerNodeId === subjectNodeId) {
    throw new ReportingLineError("This would create a reporting loop.", "هذا ينشئ حلقة في التسلسل الإداري.");
  }

  const manager = managerNodeId ? await repository.principalByNodeId(managerNodeId) : null;
  if (managerNodeId && !manager) {
    throw new ReportingLineError("That manager no longer exists.", "لم يعد هذا المدير موجوداً.");
  }

  if (managerNodeId && (await wouldReportInCircles(subjectNodeId, managerNodeId))) {
    throw new ReportingLineError("This would create a reporting loop.", "هذا ينشئ حلقة في التسلسل الإداري.");
  }

  await repository.updateReportsTo(subject, manager);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "organisation:write",
    objectType: subject.kind,
    objectLabel: subject.label,
    detail: { reportsTo: manager?.label ?? null },
  });
}

/**
 * Whether making `managerNodeId` the manager of `subjectNodeId` closes a cycle.
 *
 * Walks up from the proposed manager: if the subject is already somewhere above it, the
 * new edge would point back into its own branch.
 */
export async function wouldReportInCircles(subjectNodeId: string, managerNodeId: string): Promise<boolean> {
  if (subjectNodeId === managerNodeId) return true;

  const parents = new Map((await repository.listOrgNodes()).map((node) => [node.id, node.parent]));
  const seen = new Set<string>();
  let cursor: string | null = managerNodeId;
  while (cursor) {
    if (cursor === subjectNodeId) return true;
    // A cycle already in the data must not hang this walk.
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return false;
}
