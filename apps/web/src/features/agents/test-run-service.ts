import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { AgentRejected } from "./errors";
import { startRun } from "./run-start-service";

/**
 * `UC-51.3-01`: run the agent against a sample input and wait for what it answers.
 *
 * A real run through the agent's own route, not a simulation, because the point of the
 * playground is to see what a real one would do. It is started like any other run and so
 * appears in the agent's run list and its audit trail — a test that left no trace would be
 * a way to exercise an agent unobserved.
 *
 * `UC-51.3-06`: a model or connector that is unavailable comes back as the failure it was,
 * with the step that failed, rather than as an empty answer.
 *
 * @throws {AgentRejected} when the run cannot be started or does not answer in time.
 */
export async function testAgent(input: { code: string; prompt: string }): Promise<string> {
  const session = await requirePermission("agents:invoke");
  const runId = await startRun({ agentCode: input.code, prompt: input.prompt, screen: "playground", surface: "Playground" });

  const agentServiceUrl = env().AGENT_SERVICE_URL;
  const deadline = Date.now() + 60_000;
  let answer = "";

  // Polled rather than streamed: the playground shows one answer when it is done, and a
  // stream would be a second transport for the same events the run viewer already reads.
  while (Date.now() < deadline) {
    const response = await fetch(`${agentServiceUrl}/agui/runs/${runId}/events`).catch(() => null);
    if (response?.ok) {
      const events = (await response.json()) as string[];
      let finished = false;
      for (const raw of events) {
        const event = JSON.parse(raw) as { type?: string; delta?: string; message?: string };
        if (event.type === "TEXT_MESSAGE_CONTENT") answer += event.delta ?? "";
        if (event.type === "RUN_FINISHED") finished = true;
        if (event.type === "RUN_ERROR") {
          throw new AgentRejected(event.message ?? "The run failed.", event.message ?? "فشل التشغيل.");
        }
      }
      if (finished || answer) return answer.trim() || "(the run produced no text)";
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:invoke",
    objectType: "Run",
    objectLabel: runId,
    detail: { playground: true, timedOut: true },
    outcome: "Denied",
  });
  throw new AgentRejected("The test did not finish in time.", "لم ينتهِ الاختبار في الوقت المحدد.");
}

/**
 * `UC-52.1-06`: replay a run, optionally from one of its steps.
 *
 * A new run, linked to the one it replays, never a rewrite of it: the original is what the
 * audit trail and anyone reading it after an incident refer to, and a replay that edited it
 * would destroy the record it exists to investigate.
 *
 * The reason is required when replaying from a step. Replaying a whole run is repeating
 * what happened; starting it part-way is a person deciding the earlier steps were right,
 * and the trail should say why they thought so.
 *
 * @throws {AgentRejected} when the run is unknown, or a step replay carries no reason.
 */
export async function replayRun(input: {
  key: string;
  fromStep?: number | null;
  reason?: string;
}): Promise<string> {
  const session = await requirePermission("agents:invoke");

  const original = await repository.readRun(input.key);
  if (!original) throw new AgentRejected("That run no longer exists.", "لم يعد هذا التشغيل موجوداً.");

  if (input.fromStep != null && !input.reason?.trim()) {
    throw new AgentRejected("Say why this is being replayed from a step.", "اذكر سبب إعادة التشغيل من هذه الخطوة.");
  }

  const runId = await startRun({
    agentCode: original.run.agent,
    prompt: original.run.goal,
    surface: "WorkItem",
    contextId: original.run.by,
    replayOfRunKey: input.key,
    replayFromStep: input.fromStep ?? null,
  });

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "agents:invoke",
    objectType: "Run",
    objectLabel: input.key,
    detail: { replayedAs: runId, fromStep: input.fromStep ?? null, reason: input.reason ?? null },
  });
  return runId;
}
