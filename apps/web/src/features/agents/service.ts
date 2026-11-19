import { audit } from "@/lib/audit";
import { cancelRun as signalCancel, RunNotSignalled } from "@/lib/agent-runs";
import { logger } from "@/lib/logger";
import * as rooms from "@/features/rooms/service";
import { can, NotPermitted, requirePermission, requireSession } from "@/lib/session";
import { auditLines } from "./brief";
import * as repository from "./repository";
import type { ActivateVersionInput, RunBudgetInput, SetTrustInput } from "./schema";
import { AgentNotEditable, AgentRejected } from "./errors";
import { requireAgentPermission } from "./version-service";
import { UUID } from "./run-start-service";

export { AgentNotEditable, RunNotStarted, RunNotRefreshable, AgentRejected } from "./errors";
export { type RunSurface, startRun } from "./run-start-service";
export { type DelegatedRunPayload, registerDelegatedRun } from "./delegation-service";
export { refreshRunCredentials } from "./credentials-service";
export { saveDraft, setToolMode, revokeTool, grantConnector, changeToolGrant, changeSkills, setPlatformTool, setSkill, setKnowledgeAccess, setMemoryAccess } from "./version-service";
export { resetBuiltinToDefaults } from "./builtin-service";
export { publishVersion } from "./publish-service";
export { createAgent, loadAgentChoices, deleteAgent } from "./lifecycle-service";
export { testAgent, replayRun } from "./test-run-service";
export { clip, composeBrief, withBrief, type BriefParts, type BriefSection } from "./brief";

/**
 * D384: a record's audit trail since it was created, as brief lines. Unguarded: it is called while a run is started
 * on that record, by a service that has already checked the person may act on it.
 */
export async function auditLinesOf(objectType: string, objectLabel: string, since: Date): Promise<string[]> {
  return auditLines(await repository.auditTrailOf(objectType, objectLabel, since));
}

/** S-50 the agent list, S-51 the agent detail, S-52 the run viewer. */

export async function loadAgent(code: string) {
  await requirePermission("agents:read");
  return repository.readAgent(code);
}

/** One page of the runs matching the filter (50 unless given), newest first, for `run_list`. Requires `agents:read`. */
export async function loadRuns(filter: repository.RunFilter = {}) {
  await requirePermission("agents:read");
  return repository.listRuns(filter);
}

/** How many runs match the filter, for the Runs tab's count. Requires `agents:read`. */
export async function loadRunCount(filter: repository.RunFilter) {
  await requirePermission("agents:read");
  return repository.countRuns(filter);
}

/** One page of the runs matching the filter and how many match in all, for an agent's Runs tab (D349). Requires `agents:read`. */
export async function loadRunPage(filter: repository.RunFilter) {
  await requirePermission("agents:read");
  const [runs, total] = await Promise.all([repository.listRuns(filter), repository.countRuns(filter)]);
  return { runs, total };
}

/** One run with its steps and counters for the run viewer, or null. Requires `agents:read`. */
export async function loadRun(key: string) {
  await requirePermission("agents:read");
  return repository.readRun(key);
}

/** Whether the person may read the room a run works in; somebody without `rooms:read` may not. */
async function mayReadRunRoom(roomId: string): Promise<boolean> {
  try {
    return await rooms.mayReadRoom(roomId);
  } catch (problem) {
    if (problem instanceof NotPermitted) return false;
    throw problem;
  }
}

/**
 * Whether the signed-in person may follow one run's live events (D124): the person who
 * started it, anybody who may read the room a room run works in (D161), or anybody who may
 * read agent runs. False when no run has that id.
 *
 * @throws {NotPermitted} for anybody else, after recording the refusal.
 */
export async function mayFollowRun(runId: string): Promise<boolean> {
  const session = await requireSession();
  // Checked first, so an id that is not a uuid never reaches a uuid column.
  if (!UUID.test(runId)) return false;
  const run = await repository.readRunById(runId);
  if (!run) return false;
  if (run.personId === session.personId) return true;
  // A run in a room posts its reply to everyone who may read the room, so they watch it being
  // written too (D161). Its reads are already bounded by every member's permissions (D104).
  if (run.contextType === "Room" && run.contextId && (await mayReadRunRoom(run.contextId))) return true;
  await requirePermission("agents:read");
  return true;
}

/**
 * D67: the assistant panel's Stop. Only the person who started the run may stop it here; the
 * run viewer's cancel serves everyone else who may.
 *
 * @throws {NotPermitted} when the run is somebody else's or no run has that id.
 */
export async function stopOwnRun(runId: string): Promise<void> {
  const session = await requireSession();
  const run = UUID.test(runId) ? await repository.readRunById(runId) : null;
  if (!run || run.personId !== session.personId) {
    throw new NotPermitted("agents:invoke", "Only the person who started this run may stop it.");
  }
  await cancelRun(run.key);
}

/** D67, D295, D300: the person who started a run, the owner of its room, or an administrator. */
async function mayStopOrDelete(scope: { startedBy: string | null; roomOwner: boolean }, personId: string): Promise<boolean> {
  return scope.startedBy === personId || scope.roomOwner || (await can("system:operate"));
}

/**
 * D300: delete a finished run with its steps, approvals, questions and their Inbox items. Who may
 * is who may cancel it (D295). A run still going is cancelled first.
 */
export async function deleteRun(key: string): Promise<void> {
  const session = await requirePermission("agents:invoke");
  const scope = await repository.cancelScopeOf(key, session.personId);
  if (!scope) throw new AgentRejected("That run no longer exists.", "لم تعد هذه العملية موجودة.");
  if (!(await mayStopOrDelete(scope, session.personId))) {
    throw new NotPermitted("system:operate", "Only the person who started this run, the owner of its room or an administrator may delete it.");
  }
  if (["Queued", "Running", "Waiting"].includes(scope.status)) {
    throw new AgentRejected(`${key} is still ${scope.status.toLowerCase()}: cancel it first.`, `${key} ما زالت قيد التنفيذ: ألغِها أولاً.`);
  }
  await repository.deleteRun(scope.id);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:delete_run",
    objectType: "Run",
    objectLabel: key,
  });
}

/**
 * `UC-51.1-04`: change an agent's trust. `UC-50.2-04` keeps `System` out of the choices,
 * which the schema enforces, and this keeps a system agent itself out of reach: the
 * platform ships it at the trust it runs on, and an ordinary screen does not change that.
 * Returns the active version's new lock, for a further write in the same save.
 *
 * @throws {AgentNotEditable} when the agent is the system agent.
 */
export async function setTrust(input: SetTrustInput): Promise<number> {
  const session = await requireAgentPermission("agents:write", input.code);

  if (await repository.isSystemAgent(input.code)) {
    throw new AgentNotEditable(
      `${input.code} is a system agent and its trust is fixed: the platform ships it at the trust it runs on.`,
      `${input.code} وكيل نظام وثقته ثابتة: تشحنه المنصة بالثقة التي يعمل بها.`,
    );
  }

  const lock = await repository.setTrust(input.code, input.trust, input.version, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:write",
    objectType: "Agent",
    objectLabel: input.code,
    detail: { trust: input.trust },
  });
  return lock;
}

/**
 * `UC-51.4-04`: make one of an agent's versions the active one, which rolls back to an older
 * version. Requires `agents:publish`; writes an audit entry.
 */
export async function activateVersion(input: ActivateVersionInput): Promise<void> {
  const session = await requireAgentPermission("agents:publish", input.code);
  await repository.activateVersion(input.code, input.versionNumber, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:publish",
    objectType: "Agent",
    objectLabel: input.code,
    detail: { versionNumber: input.versionNumber },
  });
}

/**
 * `UC-51.1-05`: set an agent's run budget. The soft-above-hard case is refused by the
 * schema; this is the permission check, the write and the audit entry. Returns the active
 * version's new lock.
 */
export async function setRunBudget(input: RunBudgetInput): Promise<number> {
  const session = await requireAgentPermission("agents:write", input.code);
  const lock = await repository.setRunBudget(input.code, input.soft, input.hard, input.version, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:run_budget",
    objectType: "Agent",
    objectLabel: input.code,
    detail: { soft: input.soft, hard: input.hard },
  });
  return lock;
}

/**
 * `UC-12.1-02`, `UC-12.2-01`: a run paused for a decision or an answer is `Waiting`; once
 * the Inbox has actually told the run (`runResumed`), it is making progress again.
 *
 * The permission check belongs to whichever Inbox action is resuming the run — this is the
 * write behind it, not a new entry point of its own.
 */
export async function markRunResumed(runId: string, personId: string): Promise<void> {
  await repository.markRunStatus(runId, "Running", personId);
}

/**
 * `UC-52.1-05`, `UC-52.1-11`: stop a run after its current step, or do nothing when it has
 * already finished.
 *
 * The database row is the record of the decision, written first for the same reason an
 * approval's decision is: a row that says Cancelled and a workflow nobody told is a safer
 * failure than a workflow stopped with nothing recorded. Telling the actual run is the part
 * that makes this real rather than cosmetic — without it the row says Cancelled while the
 * workflow keeps running, spending budget and posting messages nobody asked to stop.
 */
export async function cancelRun(key: string): Promise<void> {
  const session = await requirePermission("agents:invoke");
  // D67: the person who started it, the owner of the room it runs in, or an administrator
  // (whoever may pause every agent may stop one).
  const scope = await repository.cancelScopeOf(key, session.personId);
  if (scope && !(await mayStopOrDelete(scope, session.personId))) {
    throw new NotPermitted("system:operate", "Only the person who started this run, the owner of its room or an administrator may cancel it.");
  }
  const cancelled = await repository.cancelRun(key, session.personId);
  if (cancelled) {
    try {
      await signalCancel(cancelled.id);
    } catch (problem) {
      if (!(problem instanceof RunNotSignalled)) throw problem;
      // The decision stands; an operator reading the logs is what catches a run the agent
      // service could not reach, the same gap `resumeWithDecision` already accepts.
      logger().error({ runKey: key, problem }, "a cancelled run's workflow could not be told to stop");
    }
  }
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:cancel_run",
    objectType: "Run",
    objectLabel: key,
  });
}
