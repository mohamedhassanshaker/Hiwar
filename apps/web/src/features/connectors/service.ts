import { audit } from "@/lib/audit";
import { listTools } from "@/lib/connector-runtime";
import { decrypt } from "@/lib/crypto";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import type { SaveConnectorInput, SetConnectorEnabledInput, SetToolTierInput } from "./schema";
import { ConnectorRejected } from "./errors";
import { PLATFORM_CONNECTOR_CODE } from "./types";
import { candidateCredential, pushToRuntime, viaRuntime } from "./discovery-service";
import type { StoredCredential } from "./credential";
import { beginConnect, connectorOfState, CredentialUnavailable, finishConnect, forgetToken } from "./credential-auth";
import { logger } from "@/lib/logger";
import { OpenApiCallRejected, probeServer } from "./openapi-call";

export { ConnectorRejected } from "./errors";
export { tierForTool, testConnector, testApiConnector, refreshConnectorTools, viaRuntime } from "./discovery-service";
export { CredentialUnavailable } from "./credential-auth";
export { type ImportOutcome, importApiConnector, apiOperations } from "./import-service";
/** The connector tools a run's grant names, for the platform MCP server to list and call (D223). */
export { grantedConnectorTools } from "./repository";

/**
 * A connector that is part of the platform cannot be removed, and the Platform connector,
 * whose tools are the platform's own, cannot be changed or switched off either (D228).
 */
async function refuseBuiltin(code: string, change: "remove" | "change"): Promise<void> {
  if (code === PLATFORM_CONNECTOR_CODE || (change === "remove" && (await repository.isBuiltin(code)))) {
    throw new ConnectorRejected(
      `${code} is part of the platform and cannot be ${change === "remove" ? "removed" : "changed"}.`,
      `${code} جزء من المنصة ولا يمكن ${change === "remove" ? "إزالته" : "تغييره"}.`,
    );
  }
}

/** S-54: the connectors agents call tools through. */
export async function loadConnectors() {
  await requirePermission("connectors:read");
  const [connectors, catalogue] = await Promise.all([repository.listConnectors(), repository.listCatalogue()]);
  return { connectors, catalogue };
}

/**
 * Switches a connector on or off at the version the screen holds, setting its status to Connected
 * or Disabled, and audits the change as `connectors:write`. Requires `connectors:write`; the
 * Platform connector is refused (D228), and a stale version is refused as changed by someone else.
 */
export async function setConnectorEnabled(input: SetConnectorEnabledInput): Promise<void> {
  const session = await requirePermission("connectors:write");
  await refuseBuiltin(input.code, "change");
  await repository.setEnabled(input.code, input.enabled, input.version, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "connectors:write",
    objectType: "Connector",
    objectLabel: input.code,
    detail: { enabled: input.enabled },
  });
}

/**
 * Sets one connector tool's tier and audits it as `connectors:tier`. Requires `connectors:write`;
 * the Platform connector's tools are refused (D228).
 */
export async function setToolTier(input: SetToolTierInput): Promise<void> {
  const session = await requirePermission("connectors:write");
  await refuseBuiltin(input.connectorCode, "change");
  await repository.setToolTier(input.connectorCode, input.toolName, input.tier, session.personId);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "connectors:tier",
    objectType: "ConnectorTool",
    objectLabel: `${input.connectorCode}/${input.toolName}`,
    detail: { tier: input.tier },
  });
}

/**
 * `UC-54.2-05`: remove a connector, naming the agents that depended on it.
 *
 * Those agents lose every tool it offered, which is a change to what they can do — so the
 * list is returned for the confirmation to show rather than discovered afterwards.
 */
export async function removeConnector(
  connectorCode: string,
  dryRun = false,
): Promise<{ affectedAgents: string[] }> {
  const session = await requirePermission("connectors:write");
  await refuseBuiltin(connectorCode, "remove");

  const affectedAgents = await repository.agentsUsingConnector(connectorCode);
  // The confirmation asks first and removes second; both go through the permission check,
  // because "which agents use this connector" is not public either.
  if (dryRun) return { affectedAgents };
  await repository.removeConnector(connectorCode, session.personId);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "connectors:write",
    objectType: "Connector",
    objectLabel: connectorCode,
    detail: { removed: true, affectedAgents },
  });
  return { affectedAgents };
}

/**
 * `UC-54.1-03`, `UC-54.1-05`, `UC-54.2-01`…`-04`: write the connector the drawer holds.
 *
 * Enabling is the part that cannot be left to the screen. `UC-54.1-05` says a connector
 * whose handshake failed may be added only as Disabled, so the server shakes hands itself
 * before it stores an enabled connector: a form that claims a successful test is not
 * evidence of one.
 */
export async function saveConnector(input: SaveConnectorInput): Promise<{ code: string }> {
  const session = await requirePermission("connectors:write");
  await refuseBuiltin(input.code, "change");

  if (input.transport === "StreamableHttp" && !input.url.trim()) {
    throw new ConnectorRejected("A server URL is required.", "عنوان الخادم مطلوب.");
  }
  if (input.transport === "StreamableHttp" && !/^https?:\/\//.test(input.url)) {
    throw new ConnectorRejected("The server URL must be an http or https URL.", "يجب أن يكون عنوان الخادم بصيغة http أو https.");
  }
  if (input.transport === "Stdio" && !input.command.trim()) {
    throw new ConnectorRejected("A command is required.", "يلزم أمر تشغيل.");
  }

  const existingId = await repository.connectorIdByCode(input.code);
  if (input.version === undefined && existingId) {
    throw new ConnectorRejected("A connector with that code already exists.", "يوجد موصل بهذا الرمز بالفعل.");
  }
  if (input.version !== undefined && !existingId) {
    throw new ConnectorRejected("That connector no longer exists.", "لم يعد هذا الموصل موجوداً.");
  }

  // D296: the credential to store, the drawer's merged into the stored one; absent keeps it.
  const authType = input.credential?.type ?? input.authType;
  const target = await candidateCredential(input.code, input.url, authType, input.credential);
  const credential = input.credential ? (target.secretRef ? (JSON.parse(decrypt(target.secretRef)) as StoredCredential) : null) : authType === "None" ? null : undefined;

  // A REST API has no MCP server to shake hands with: it is reached as a run's call would be (D268).
  if (input.enabled && input.transport === "OpenApi") {
    try {
      const status = await probeServer({ ...target, serverUrl: input.url });
      if (status >= 500) throw new OpenApiCallRejected(`The API answered ${status}.`, `أجابت الواجهة ${status}.`);
    } catch (problem) {
      if (!(problem instanceof OpenApiCallRejected)) throw problem;
      throw new ConnectorRejected(`${problem.message} It can be saved as Disabled.`, `${problem.messageAr} يمكن حفظه معطّلاً.`);
    }
  } else if (input.enabled) {
    try {
      await pushToRuntime({
        connector: {
          connector_id: input.code,
          name: input.code,
          transport: input.transport === "Stdio" ? "stdio" : "http",
          url: input.url,
          command: input.transport === "Stdio" ? repository.splitCommand(input.command) : [],
          enabled: true,
        },
        credential: target,
      });
      await viaRuntime(input.code, () => listTools(input.code));
    } catch (problem) {
      if (problem instanceof CredentialUnavailable) {
        throw new ConnectorRejected(`${problem.message} It can be added as Disabled.`, `${problem.messageAr} يمكن إضافته معطّلاً.`);
      }
      throw new ConnectorRejected(
        `${problem instanceof Error ? problem.message : "The handshake failed."} It can be added as Disabled.`,
        `${problem instanceof Error ? problem.message : "فشل التفاوض الأولي."} يمكن إضافته معطّلاً.`,
      );
    }
  }

  const entry = input.catalogueId ? await repository.readCatalogueEntry(input.catalogueId) : null;
  await repository.saveConnector(
    {
      ...input,
      authType,
      credential,
      nameEn: input.nameEn || entry?.nameEn || input.code,
      nameAr: input.nameAr || entry?.nameAr || input.nameEn || input.code,
    },
    session.personId,
  );

  if (credential !== undefined) forgetToken(input.code);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "connectors:write",
    objectType: "Connector",
    objectLabel: input.code,
    detail: {
      added: input.version === undefined,
      authType,
      enabled: input.enabled,
      tools: input.tools.length,
    },
  });
  return { code: input.code };
}

/** The remote MCP server an administrator connects with OAuth (D296). */
async function oauthTarget(code: string) {
  await refuseBuiltin(code, "change");
  const connector = await repository.readConnector(code);
  if (!connector) throw new ConnectorRejected("That connector no longer exists.", "لم يعد هذا الموصل موجوداً.");
  if (connector.transport !== "StreamableHttp" || connector.authType !== "OAuth" || !connector.serverUrl) {
    throw new ConnectorRejected(
      "Connect is for a remote MCP server whose authentication is OAuth 2.1 authorization code. Save it that way first.",
      "الربط مخصص لخادم MCP بعيد مصادقته رمز تفويض OAuth 2.1. احفظه بهذه الطريقة أولاً.",
    );
  }
  return { ...connector, serverUrl: connector.serverUrl };
}

/**
 * D296: start connecting an OAuth connector. Returns the authorization server's sign-in address,
 * where the administrator signs in; the server sends them back to the callback route.
 */
export async function beginOAuthConnect(code: string): Promise<string> {
  const session = await requirePermission("connectors:write");
  const connector = await oauthTarget(code);
  try {
    return await beginConnect(connector, session.personId);
  } catch (problem) {
    if (problem instanceof CredentialUnavailable) throw new ConnectorRejected(problem.message, problem.messageAr);
    throw problem;
  }
}

/**
 * D296: finish a Connect from the authorization server's callback, store the tokens, and send the
 * runtime the headers they make. Returns the connector's code.
 */
export async function finishOAuthConnect(state: string, authorizationCode: string): Promise<string> {
  const session = await requirePermission("connectors:write");
  const code = connectorOfState(state);
  const connector = await oauthTarget(code);
  try {
    await finishConnect(connector, state, authorizationCode, session.personId);
  } catch (problem) {
    if (problem instanceof CredentialUnavailable) throw new ConnectorRejected(problem.message, problem.messageAr);
    throw problem;
  }
  forgetToken(code);
  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "connectors:write",
    objectType: "Connector",
    objectLabel: code,
    detail: { connected: "OAuth" },
  });
  try {
    await pushToRuntime();
  } catch (problem) {
    // The tokens are stored; the next call sends them (`viaRuntime`).
    logger().warn({ connector: code, problem: String(problem) }, "the runtime was not sent a newly connected connector's credential");
  }
  return code;
}
