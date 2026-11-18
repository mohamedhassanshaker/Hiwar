import { insertAuditEntry } from "@/db/queries/audit";
import { NotPermitted, runAs } from "@/lib/session";
import { RunNotStarted, startRun } from "@/features/agents/service";
import * as repository from "./repository";
import type { ClientCaller } from "./repository";

/**
 * Resolves an API key to the client it belongs to.
 *
 * There is no session: the key is the credential. Everything that decides whether it works
 * — revoked, expired, or a deactivated client — is settled in one place, so the MCP and
 * AG-UI endpoints cannot disagree about it.
 */
export async function authenticateClient(secret: string): Promise<ClientCaller | null> {
  return repository.authenticateClientKey(secret);
}

/** `UC-77.4-02`: a call the client is not permitted, refused and recorded against it. */
export async function recordClientRefusal(caller: ClientCaller, action: string, detail: Record<string, unknown>): Promise<void> {
  await insertAuditEntry({
    actorType: "Client",
    actorId: caller.clientId,
    actorLabel: caller.clientCode,
    action,
    objectType: "Tool",
    objectId: null,
    objectLabel: String(detail.tool ?? action),
    detailJson: detail,
    outcome: "Denied",
  });
}

/** Why an AG-UI call from a client was refused, as the endpoint answers it. */
export type ClientStreamRefusal = "NoCredential" | "OriginNotAllowed" | "AguiOff" | "AgentNotAllowed" | "NotPermitted" | "RunNotStarted";

/**
 * `UC-77.3-01` and `UC-77.3-03`: starts a run for an integration client.
 *
 * Everything the admin configured is enforced here: the exposure has to be on, the origin
 * has to be one of the allowed ones, and the agent has to be one the client was given. The
 * run itself is started as the client's owner, so the agent's own permission checks and
 * budget apply exactly as they do in the console.
 */
export async function startClientRun(input: {
  secret: string;
  origin: string | null;
  agentCode: string;
  prompt: string;
}): Promise<{ runId: string } | { refusal: ClientStreamRefusal; detail: string }> {
  const caller = await repository.authenticateClientKey(input.secret);
  if (!caller) return { refusal: "NoCredential", detail: "The key is not valid." };
  if (!caller.agui.enabled) return { refusal: "AguiOff", detail: "AG-UI streaming is off for this client." };

  const allowed = caller.agui.allowedOrigins.map((one) => one.replace(/\/$/, "").toLowerCase());
  if (!input.origin || !allowed.includes(input.origin.replace(/\/$/, "").toLowerCase())) {
    await recordClientRefusal(caller, "agui:stream", { reason: "origin", origin: input.origin });
    return { refusal: "OriginNotAllowed", detail: "This origin is not allowed." };
  }
  if (!caller.permissions.includes("agents:invoke")) {
    await recordClientRefusal(caller, "agui:stream", { reason: "permission", agent: input.agentCode });
    return { refusal: "NotPermitted", detail: "This client may not run agents." };
  }
  if (!caller.allAgents && !caller.agentCodes.includes(input.agentCode)) {
    await recordClientRefusal(caller, "agui:stream", { reason: "agent", agent: input.agentCode });
    return { refusal: "AgentNotAllowed", detail: `${input.agentCode} is not available to this client.` };
  }
  if (!caller.ownerPersonId) return { refusal: "NotPermitted", detail: "This client has no owner to act for." };

  try {
    const runId = await runAs(caller.ownerPersonId, { id: caller.clientId, label: caller.clientCode }, () =>
      startRun({ agentCode: input.agentCode, prompt: input.prompt, surface: "Deployment" }),
    );
    return { runId };
  } catch (problem) {
    // The two refusals `startRun` raises, answered as the console's own AG-UI route answers them.
    if (problem instanceof NotPermitted) return { refusal: "NotPermitted", detail: "The client's owner may not run agents." };
    if (problem instanceof RunNotStarted) return { refusal: "RunNotStarted", detail: problem.message };
    throw problem;
  }
}

/** The events a client's stream is allowed to carry, for the endpoint to filter by. */
export async function clientStreamEvents(secret: string): Promise<string[]> {
  const caller = await repository.authenticateClientKey(secret);
  return caller?.agui.allowedEvents ?? [];
}
