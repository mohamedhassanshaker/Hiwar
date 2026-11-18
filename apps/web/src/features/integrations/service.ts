import { PERMISSIONS, type PermissionCode } from "@/authz/permissions";
import { PLATFORM_TOOLS } from "@/mcp/tools";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { MCP_PROTOCOL_VERSION } from "@/mcp/server";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { ClientOption } from "./types";
import type {
  CreateClientInput,
  CreateKeyInput,
  RotateKeyInput,
  SetAguiInput,
  SetClientStatusInput,
  SetMcpInput,
  SetPermissionsInput,
} from "./schema";

export {
  authenticateClient,
  recordClientRefusal,
  type ClientStreamRefusal,
  startClientRun,
  clientStreamEvents,
} from "./client-access-service";

/** S-76 the clients, S-77 one client with its keys and exposures. */

export async function loadIntegrations() {
  await requirePermission("integrations:read");
  const [clients, details] = await Promise.all([repository.listClients(), repository.readDetails()]);

  // The tools a client may be exposed, and the permissions those tools check, come from the
  // platform's own catalogue. A screen that offered anything else would offer a permission
  // that enables nothing, or a tool that cannot be reached.
  const tools: ClientOption[] = PLATFORM_TOOLS.map((tool) => ({ code: tool.name, en: tool.description, ar: tool.description }));
  const permissionCodes = [...new Set([...PLATFORM_TOOLS.map((tool) => tool.permission), "agents:invoke"])].sort();
  const permissions: ClientOption[] = permissionCodes.map((code) => ({
    code,
    en: PERMISSIONS[code as PermissionCode]?.en ?? code,
    ar: PERMISSIONS[code as PermissionCode]?.ar ?? code,
  }));

  // The endpoints a client is given are this platform's own, so the screen does not guess them.
  return { clients, details, tools, permissions, base: env().APP_URL.replace(/[/]$/, "") };
}

/** Creates an active client with its permissions and both exposures off. Needs `integrations:write`; audited. */
export async function createClient(input: CreateClientInput): Promise<void> {
  const session = await requirePermission("integrations:write");
  await repository.createClient(input, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:write",
    objectType: "IntegrationClient",
    objectLabel: input.clientId,
    detail: { permissions: input.permissions },
  });
}

/** The secret is returned once to the caller and never stored in readable form. */
export async function createKey(input: CreateKeyInput): Promise<string> {
  const session = await requirePermission("integrations:write");
  const secret = await repository.createKey(input.clientId, input.name, input.expiresInDays, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:create_key",
    objectType: "ClientKey",
    objectLabel: `${input.clientId}/${input.name}`,
    detail: { expiresInDays: input.expiresInDays },
  });
  return secret;
}

/** Revokes one key. Needs `integrations:write`; audited as `integrations:revoke_key`. */
export async function revokeKey(keyId: string): Promise<void> {
  const session = await requirePermission("integrations:write");
  await repository.revokeKey(keyId, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:revoke_key",
    objectType: "ClientKey",
    objectId: keyId,
  });
}

/** `UC-77.1-02`: a new secret, shown once; the old one stops after its grace period. */
export async function rotateKey(input: RotateKeyInput): Promise<string> {
  const session = await requirePermission("integrations:write");
  const secret = await repository.rotateKey(input.keyId, input.graceHours, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:rotate_key",
    objectType: "ClientKey",
    objectId: input.keyId,
    detail: { graceHours: input.graceHours },
  });
  return secret;
}

/** `UC-77.5-01`: deactivating a client stops every key it has at once. */
export async function setClientStatus(input: SetClientStatusInput): Promise<void> {
  const session = await requirePermission("integrations:write");
  await repository.setClientStatus(input.clientCode, input.status, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:write",
    objectType: "IntegrationClient",
    objectLabel: input.clientCode,
    detail: { status: input.status },
  });
}

/**
 * Removes a client and everything issued under it — its keys, permissions, and agent and
 * tool exposure — which is harder to undo than deactivating it. Deactivating stops every
 * key at once and can be reversed; this cannot.
 */
export async function deleteClient(clientCode: string): Promise<void> {
  const session = await requirePermission("integrations:write");
  await repository.deleteClient(clientCode);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:delete",
    objectType: "IntegrationClient",
    objectLabel: clientCode,
  });
}

/** `UC-77.4-01`: the permissions and agents a client's calls are limited to. */
export async function setPermissions(input: SetPermissionsInput): Promise<void> {
  const session = await requirePermission("integrations:write");
  if (input.permissions.length === 0) throw new Error("A client with no permission can do nothing; give it at least one.");
  await repository.setClientPermissions(input.clientCode, input.permissions, session.personId);
  await repository.setClientAgents(input.clientCode, input.agentCodes, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:write",
    objectType: "IntegrationClient",
    objectLabel: input.clientCode,
    detail: { permissions: input.permissions, agents: input.agentCodes },
  });
}

/** Saves the client's MCP exposure: enabled, authentication type and exposed tools. Needs `integrations:write`; audited. */
export async function setMcp(input: SetMcpInput): Promise<void> {
  const session = await requirePermission("integrations:write");
  await repository.setMcpExposure(input.clientCode, input, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:write",
    objectType: "ClientMcpExposure",
    objectLabel: input.clientCode,
    detail: { enabled: input.enabled, tools: input.exposedTools.length },
  });
}

/** Saves the client's AG-UI exposure, its events and origins. Needs `integrations:write`; audited. */
export async function setAgui(input: SetAguiInput): Promise<void> {
  const session = await requirePermission("integrations:write");
  await repository.setAguiExposure(input.clientCode, input, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "integrations:write",
    objectType: "ClientAguiExposure",
    objectLabel: input.clientCode,
    detail: { enabled: input.enabled, origins: input.allowedOrigins.length },
  });
}

/**
 * `UC-77.2-02`: calls `tools/list` on this platform's own MCP endpoint with a key the admin
 * supplies, and reports what came back.
 *
 * The secret is never read back from storage, so the test asks for it: that is the same
 * thing an integrator would paste into their own client.
 */
export async function testMcpConnection(clientCode: string, secret: string): Promise<string> {
  const session = await requirePermission("integrations:write");
  // The server's own listener, as the AG-UI runtime calls itself (`agents/runtime.ts`): the
  // public origin goes back out through the gateway, whose name and certificate a container
  // does not have, and the test would report "fetch failed" for an endpoint that works.
  const endpoint = `http://127.0.0.1:${process.env.PORT ?? "3000"}/api/mcp`;

  let result: string;
  try {
    const answer = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await answer.json().catch(() => ({}))) as { result?: { tools?: unknown[] }; error?: { message?: string } };
    result = answer.ok && body.result
      ? `Handshake OK · protocol ${MCP_PROTOCOL_VERSION} · ${body.result.tools?.length ?? 0} tools listed`
      : `Refused: ${body.error?.message ?? answer.status}`;
  } catch (problem) {
    result = `No answer: ${problem instanceof Error ? problem.message : String(problem)}`;
  }

  await repository.recordMcpTest(clientCode, result, session.personId);
  return result;
}
