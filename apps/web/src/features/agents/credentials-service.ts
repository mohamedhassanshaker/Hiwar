import { mintRunToken, RUN_TOKEN_LIFETIME_SECONDS } from "@/lib/run-token";
import * as repository from "./repository";
import { resumeGrant, HARNESS_PLUMBING_TOOLS } from "./run-payload";
import { RunNotRefreshable } from "./errors";
import { configuredGrant } from "./run-start-service";

/** Statuses past which a run gets no new credentials. */
const TERMINAL_FOR_REFRESH = ["Succeeded", "Failed", "Cancelled", "BudgetExceeded"];

/**
 * Fresh credentials for a run that is still going (#31, D50, D82).
 *
 * The run token lives 30 minutes. A mission that pauses for an approval, or simply works
 * for longer than that, used to resume with a dead credential: every call after it failed
 * on an expired signature, and the person who approved it saw a broken run rather than a
 * refusal. This is the one function that mints a replacement, and both paths that need
 * one — the resume signal and the harness's own refresh — call it.
 *
 * The grant is re-derived, never copied: the current configuration intersected with the
 * run row's snapshot, so it can shrink and never grow (D50). A tool revoked while the run
 * was waiting is gone when it resumes, which is the point of revoking it.
 *
 * @throws {RunNotRefreshable} for a run that is finished or cancelled. A terminated run
 * getting a working credential is precisely what termination is supposed to prevent.
 */
export async function refreshRunCredentials(runId: string): Promise<{
  mcpToken: string;
  harnessToken: string;
  grantedTools: string[];
  expiresAt: string;
}> {
  const run = await repository.readRunById(runId);
  if (!run) throw new RunNotRefreshable("There is no such run.", "لا يوجد تشغيل بهذا المعرف.");
  if (TERMINAL_FOR_REFRESH.includes(run.status)) {
    throw new RunNotRefreshable(
      `${run.key} is ${run.status.toLowerCase()} and gets no new credentials.`,
      `${run.key} في حالة ${run.status.toLowerCase()} ولا يحصل على بيانات اعتماد جديدة.`,
    );
  }
  if (!run.personId) {
    throw new RunNotRefreshable(
      `${run.key} names no person to act for.`,
      `${run.key} لا يحدد الشخص الذي ينوب عنه.`,
    );
  }

  const configured = await configuredGrant({
    agentId: run.agentId,
    agentVersionId: run.agentVersionId,
    contextType: run.contextType,
    contextId: run.contextId,
  });
  const tools = resumeGrant(run.grantedTools, configured.tools);

  const [mcpToken, harnessToken] = await Promise.all([
    mintRunToken({
      kind: "model",
      runId: run.id,
      agentId: run.agentId,
      personId: run.personId,
      routes: [run.route],
      connectors: configured.connectors,
      tools,
    }),
    mintRunToken({
      kind: "harness",
      runId: run.id,
      agentId: run.agentId,
      personId: run.personId,
      routes: [run.route],
      connectors: configured.connectors,
      tools: [...HARNESS_PLUMBING_TOOLS],
    }),
  ]);

  // The snapshot follows the grant down, so a later refresh cannot widen back to what
  // the row said before this one narrowed it.
  await repository.narrowRunGrant(run.id, tools);

  return {
    mcpToken,
    harnessToken,
    grantedTools: tools,
    expiresAt: new Date(Date.now() + RUN_TOKEN_LIFETIME_SECONDS * 1000).toISOString(),
  };
}
