import { env } from "./env";
import { logger } from "./logger";

/**
 * Signalling a run that is waiting for a person (`UC-12.1-02`, `UC-12.2-01`).
 *
 * A run paused on a T2 tool call or an agent question is blocked on a Temporal signal, not
 * polling a table. So a decision taken in the Inbox has to reach the workflow: the decision
 * is recorded here in the database, and the run is told through the agent service, which is
 * the only process that holds a Temporal client.
 *
 * The order matters. The decision is written first and the signal sent second, because a
 * decision that was recorded and not delivered can be re-sent, while a run resumed on a
 * decision nothing recorded has acted on an approval that does not exist.
 */

/** Thrown when the run could not be told. The decision still stands. */
export class RunNotSignalled extends Error {
  constructor(
    readonly runKey: string,
    cause: unknown,
  ) {
    super(`the decision was recorded but the run ${runKey} was not resumed`);
    this.name = "RunNotSignalled";
    this.cause = cause;
  }
}

/**
 * POSTs `body` to the agent service at `/agui/runs/<runId>/<path>`, waiting at most 15 seconds.
 * Throws `RunNotSignalled`, after logging, when `AGENT_SERVICE_URL` is not set, the call fails or
 * the service answers with an error status.
 */
async function signal(runId: string, path: string, body: unknown): Promise<void> {
  const base = env().AGENT_SERVICE_URL;
  if (!base) throw new RunNotSignalled(runId, new Error("AGENT_SERVICE_URL is not set"));

  let response: Response;
  try {
    response = await fetch(`${base}/agui/runs/${encodeURIComponent(runId)}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (problem) {
    logger().error({ runId, path, problem }, "the run could not be signalled");
    throw new RunNotSignalled(runId, problem);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger().error({ runId, path, status: response.status, detail }, "the run refused the signal");
    throw new RunNotSignalled(runId, new Error(`${response.status} ${detail.slice(0, 200)}`));
  }
}

/**
 * `UC-12.1-02`, `-05`, `-07`: the decision that resumes a waiting run.
 *
 * A refusal resumes the run too: the tool call does not happen, the agent is told why, and
 * it carries on with that as its result. A run left waiting for a rejection it was never
 * told about would sit until the approval timed out.
 */
export async function resumeWithDecision(input: {
  runId: string;
  callId: string;
  approved: boolean;
  decidedBy: string;
  note?: string;
  /** The person asked for the call to be changed rather than refusing it (D285). */
  changesRequested?: boolean;
}): Promise<void> {
  await signal(input.runId, "approve", {
    call_id: input.callId,
    approved: input.approved,
    decided_by: input.decidedBy,
    note: input.note ?? "",
    changes_requested: input.changesRequested ?? false,
    ...(await freshCredentials(input.runId)),
  });
}

/**
 * The credentials a resumed run carries on, as part of the signal that wakes it (#31).
 *
 * A run waiting on a person has usually outlived its 30-minute token, so resuming it
 * without new ones resumes it dead: the approved call fails on an expired signature and
 * the person who approved it sees a broken run rather than their decision taking effect.
 * The platform is what mints tokens, and it is already talking to the workflow here, so
 * the decision and the credential travel together.
 *
 * A failure to mint does not block the decision. The decision is the thing that must not
 * be lost; a run that wakes with a stale token can still refresh itself, and one that
 * cannot will fail honestly rather than silently skipping the approval.
 */
async function freshCredentials(runId: string): Promise<Record<string, unknown>> {
  try {
    const { refreshRunCredentials } = await import("@/features/agents/service");
    const fresh = await refreshRunCredentials(runId);
    return {
      mcp_token: fresh.mcpToken,
      harness_token: fresh.harnessToken,
      granted_tools: fresh.grantedTools,
      expires_at: fresh.expiresAt,
    };
  } catch (problem) {
    logger().error({ runId, problem }, "a resumed run could not be given fresh credentials");
    return {};
  }
}

/** `UC-12.2-01`: the answer that resumes a run waiting on a question. */
export async function resumeWithAnswer(input: {
  runId: string;
  questionId: string;
  answer: string;
  answeredBy: string;
}): Promise<void> {
  await signal(input.runId, "answer", {
    question_id: input.questionId,
    answer: input.answer,
    answered_by: input.answeredBy,
    ...(await freshCredentials(input.runId)),
  });
}

/** `UC-52.1-10`: stop a run at its next safe point. */
export async function cancelRun(runId: string): Promise<void> {
  await signal(runId, "cancel", {});
}
