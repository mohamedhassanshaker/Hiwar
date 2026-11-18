import { platformToolName } from "@/features/connectors/tool-name";
import * as rooms from "@/features/rooms/service";
import { ACCESS_CHANGE_SEPARATE_IN, APPROVAL_LIFETIME_MINUTES, argumentsHash, REQUESTER_DECIDES_IN, targetVersion } from "@/lib/approval-binding";
import { audit } from "@/lib/audit";
import { notifyDashboard, notifyInbox } from "@/lib/live";
import { logger } from "@/lib/logger";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";

/** A context id is a row id or it is a screen path; only the first may reach a uuid column. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Spend the approval a T2 or escalated call presents, or say why it does not hold.
 *
 * No permission check of its own, deliberately: the binding *is* the check. The approval
 * names a run, and the only thing that can present it is a token minted for that run, so
 * there is no wider authority to test. Called before the tool's own service runs, so a
 * call that cannot show an approval has written nothing (D49).
 */
export async function spendApproval(input: {
  approvalId: string;
  runId: string;
  toolName: string;
  argumentsHash: string;
  targetVersion: number | null;
}): Promise<{ ok: true; key: string } | { ok: false; reason: repository.ApprovalClaimFailure }> {
  return repository.claimApproval(input);
}

/**
 * `UC-12.1-01`: record the approval a paused call waits on, called by the harness on the run's behalf
 * (`approval_create`). Requires `agents:invoke`.
 *
 * Binds the approval to the tool's platform name, the arguments' hash and the target record
 * version, and puts it in each approver's Inbox. Marks the run `Waiting`, audits the request,
 * announces it in the run's room when there is one, and notifies the dashboard and the
 * approvers. Logs a warning when nobody can decide it. Throws when the run does not exist.
 */
export async function requestApproval(input: {
  run_id: string;
  tool_name: string;
  call_id: string;
  arguments: Record<string, unknown>;
  tier: string;
  reason: string;
  context_type: string;
  context_id: string;
  /** The call changes who may do what, so in a room the requester does not decide it (D253, D284). */
  separateApprover?: boolean;
}): Promise<{ id: string; key: string; approvers: number }> {
  const session = await requirePermission("agents:invoke");
  // The paused call names a connector tool as the model saw it; the call it retries is bound by the platform's name (D223).
  const toolName = platformToolName(input.tool_name);

  const run = await repository.readRunById(input.run_id);
  if (!run) throw new Error("no such run");

  // In a room the approver is the person who asked, and only them (decision (f), D105).
  // The room card already refuses anybody else, and an approval the card will not let
  // you decide but the Inbox will is two answers to one question. Elsewhere the
  // platform's separation of duties stands: an approval goes to the people who hold
  // `approvals:decide`, never to the requester (conflict C-1, now settled per surface).
  // A call that changes who may do what goes to those people in a room too (D253); in the
  // assistant panel the person asking decides it as well (D284). Those people are the ones
  // whose `approvals:decide` reaches the project the run works in, read from the run row.
  const approvers =
    REQUESTER_DECIDES_IN.includes(run.contextType) && !(input.separateApprover && ACCESS_CHANGE_SEPARATE_IN.includes(run.contextType))
      ? [run.personId ?? session.personId]
      : await repository.approversFor(
          session.personId,
          run.contextId && UUID.test(run.contextId) ? await repository.projectOfContext(run.contextType, run.contextId) : null,
        );
  const approval = await repository.createApproval(
    {
      runId: run.id,
      callId: input.call_id,
      action: toolName,
      argumentsRedacted: input.arguments,
      // What a person is actually agreeing to (D20). The hash is taken from the arguments
      // as they stand now, so a retry with anything else — a different amount, a different
      // target — does not match and has to be approved again.
      argumentsHash: argumentsHash(input.arguments),
      targetVersion: targetVersion(input.arguments),
      expiresAt: new Date(Date.now() + APPROVAL_LIFETIME_MINUTES * 60_000),
      reason: input.reason,
      // A T3 call never reaches here, so what is left is a T2 call waiting on a person and
      // a T1 confirmation; the first is the one that carries risk.
      risk: input.tier === "T2" ? "High" : "Medium",
      // Only a real row id, whatever the run claims its context is: a context id is a free
      // string to the agent service, and writing one straight into a uuid column makes a
      // malformed value fail the insert — which blocks the run on an approval that was
      // never created, rather than failing the tool call it came from.
      workItemId: input.context_type === "WorkItem" && UUID.test(input.context_id ?? "") ? input.context_id : null,
      approvers,
    },
    session.personId,
  );
  // The run is blocked on a Temporal signal from here on, not making progress — the Agent
  // run list and the room's own status read this, so without it a paused run reads as a
  // slow one with no way to tell they are the ones it is waiting on (`UC-12.1-01`).
  await repository.markRunStatus(run.id, "Waiting", session.personId);

  if (approvers.length === 0) {
    // Nobody can decide it, so the run would wait until the approval expired. Saying so
    // here is what turns a silent timeout into something an operator can fix.
    logger().warn(
      { runId: run.key, approval: approval.key },
      "an approval was created with nobody able to decide it",
    );
  }

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "approvals:request",
    objectType: "Approval",
    objectId: approval.id,
    objectLabel: approval.key,
    detail: { tool: toolName, tier: input.tier, approvers: approvers.length },
  });
  // `UC-12.1-01`: a run paused inside a room announces the approval there, so the people
  // in that room decide it where the work is instead of being sent to the Inbox to find
  // out why the agent stopped mid-conversation.
  if (run.contextType === "Room" && run.contextId) {
    await rooms.noteApprovalInRoom(run.contextId, approval.key, toolName, session.personId);
  }
  // The approvers are looking at an inbox and a dashboard that have just changed.
  await Promise.all([notifyDashboard("approval"), ...approvers.map((id) => notifyInbox(id, "approval"))]);
  return { ...approval, approvers: approvers.length };
}
