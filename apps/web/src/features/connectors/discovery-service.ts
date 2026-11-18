import { audit } from "@/lib/audit";
import {
  listTools,
  reloadConnectors,
  RuntimeCredentialMissing,
  type DiscoveredTool,
  type RuntimeConnector,
} from "@/lib/connector-runtime";
import { requirePermission } from "@/lib/session";
import * as repository from "./repository";
import { decrypt, encrypt } from "@/lib/crypto";
import { mergeCredential, readCredential, type CredentialInput } from "./credential";
import { CredentialUnavailable, requestAuth, type CredentialTarget } from "./credential-auth";
import { ConnectorRejected } from "./errors";
import { OpenApiCallRejected, probeServer } from "./openapi-call";
import { PLATFORM_CONNECTOR_CODE } from "./types";

/**
 * Hand the runtime the whole configured set with one connector added or replaced.
 *
 * The runtime replaces rather than merges, so pushing a single connector on its own would
 * leave every other one unreachable until the next save — which is what testing a new
 * connector would otherwise do to a working platform.
 */
export async function pushToRuntime(candidate?: { connector: RuntimeConnector; credential: CredentialTarget | null }): Promise<void> {
  const stored = await repository.runtimeConnectors();
  const set = [...stored.filter((one) => one.connector.connector_id !== candidate?.connector.connector_id), ...(candidate ? [candidate] : [])];
  await reloadConnectors(await Promise.all(set.map(({ connector, credential }) => withCredential(connector, credential))));
}

/**
 * D296: when the headers the runtime holds for each HTTP connector stop working (null: they
 * do not expire), and why a connector has none. Per web process: one that has pushed nothing
 * yet pushes before its first call.
 */
const sentUntil = new Map<string, number | null>();
const unavailable = new Map<string, CredentialUnavailable>();

/** An HTTP connector with the headers its credential produces, held by the runtime in memory only. */
async function withCredential(connector: RuntimeConnector, credential: CredentialTarget | null): Promise<RuntimeConnector> {
  const code = connector.connector_id;
  unavailable.delete(code);
  if (connector.transport !== "http" || !credential || credential.authType === "None") {
    sentUntil.set(code, null);
    return connector;
  }
  try {
    const auth = await requestAuth(credential);
    sentUntil.set(code, auth.expiresAt);
    return { ...connector, headers: auth.headers, query: auth.query, needs_credential: true };
  } catch (problem) {
    if (!(problem instanceof CredentialUnavailable)) throw problem;
    sentUntil.set(code, null);
    unavailable.set(code, problem);
    return { ...connector, needs_credential: true };
  }
}

/**
 * One call to a connector through the runtime, with the credential it needs in place: the
 * set is sent again first when this process has not sent it or the connector's token is
 * about to lapse, and once more when the runtime says it lost the headers (a restart).
 *
 * @throws {CredentialUnavailable} when the connector's credential cannot be used, with what to do.
 */
export async function viaRuntime<T>(code: string, call: () => Promise<T>): Promise<T> {
  const until = sentUntil.get(code);
  if (until === undefined || (until !== null && until <= Date.now())) await pushToRuntime();
  const refused = unavailable.get(code);
  if (refused) throw refused;
  try {
    return await call();
  } catch (problem) {
    if (!(problem instanceof RuntimeCredentialMissing)) throw problem;
    await pushToRuntime();
    const still = unavailable.get(code);
    if (still) throw still;
    return call();
  }
}

/**
 * D296: the credential a connector not saved yet is tried with: what the drawer holds, with the
 * secrets an edit left empty taken from the stored one.
 */
export async function candidateCredential(
  code: string,
  serverUrl: string,
  authType: string,
  input: CredentialInput | undefined,
): Promise<CredentialTarget> {
  const stored = await repository.readConnector(code);
  const kept = stored?.secretRef ? readCredential(stored.authType, decrypt(stored.secretRef)) : null;
  const merged = input ? mergeCredential(input, kept) : kept;
  if (merged === "missing") {
    throw new ConnectorRejected("Enter the credential's secret.", "أدخل سر بيانات الاعتماد.");
  }
  return { code, serverUrl, authType: input?.type ?? authType, secretRef: merged ? encrypt(JSON.stringify(merged)) : null };
}

/**
 * The tier a newly discovered tool starts at (`UC-54.1-07`, `UC-54.1-08`).
 *
 * MCP lets a server annotate a tool as read-only or destructive, and those two say
 * everything that matters here: a tool that cannot change anything is safe to let an agent
 * call unattended, and one the server itself calls destructive is not. An unannotated tool
 * falls to the connector's own default rather than to the loosest tier, because a server
 * that said nothing has not said "safe".
 */
export function tierForTool(
  annotations: { readOnlyHint?: boolean | null; destructiveHint?: boolean | null },
  defaultTier: string,
): string {
  if (annotations.destructiveHint) return "T2";
  if (annotations.readOnlyHint) return "T0";
  return defaultTier;
}

/**
 * `UC-54.1-02`: the handshake. Registers the connector with the runtime and lists its
 * tools, so the admin sees what they are about to grant before they grant it.
 *
 * Nothing is stored. `UC-54.1-05`: a handshake that fails comes back as the error, and the
 * screen then offers to add the connector Disabled — a connector that could not be reached
 * is a configuration someone still wants to keep, not a reason to lose the form.
 */
export async function testConnector(input: {
  connectorId: string;
  name: string;
  transport: "stdio" | "http";
  url?: string;
  command?: string[];
  authType?: string;
  credential?: CredentialInput;
  defaultTier?: string;
}): Promise<{ tools: (DiscoveredTool & { tier: string })[] }> {
  await requirePermission("connectors:write");

  if (input.transport === "http" && !input.url?.trim()) {
    // `UC-54.1-06`: an HTTP connector with no URL cannot be reached by anyone.
    throw new ConnectorRejected("A server URL is required.", "عنوان الخادم مطلوب.");
  }
  if (input.url && !/^https?:\/\//.test(input.url)) {
    throw new ConnectorRejected("The server URL must be an http or https URL.", "يجب أن يكون عنوان الخادم بصيغة http أو https.");
  }
  if (input.transport === "stdio" && !input.command?.length) {
    // The runtime refuses a stdio connector with no command outright; said here instead of
    // as its 422, since this is the one thing a `stdio` connector cannot be configured without.
    throw new ConnectorRejected("A command is required.", "يلزم أمر تشغيل.");
  }

  try {
    await pushToRuntime({
      connector: {
        connector_id: input.connectorId,
        name: input.name,
        transport: input.transport,
        url: input.url ?? "",
        command: input.command ?? [],
        enabled: true,
      },
      credential: await candidateCredential(input.connectorId, input.url ?? "", input.authType ?? "None", input.credential),
    });
    const refused = unavailable.get(input.connectorId);
    if (refused) throw refused;
    const tools = await listTools(input.connectorId);
    return {
      tools: tools.map((tool) => ({ ...tool, tier: tierForTool(tool, input.defaultTier ?? "T1") })),
    };
  } catch (problem) {
    if (problem instanceof CredentialUnavailable || problem instanceof ConnectorRejected) {
      throw new ConnectorRejected(problem.message, problem.messageAr);
    }
    throw new ConnectorRejected(
      problem instanceof Error ? problem.message : "The handshake failed.",
      problem instanceof Error ? problem.message : "فشل التفاوض الأولي.",
    );
  }
}

/**
 * `UC-54.2-06`: compare what the server offers now with what was registered.
 *
 * A tool that disappeared or arrived since registration is not a detail. The tiers an admin
 * set are per tool, so a server that quietly swapped its tool list would have an agent
 * calling something nobody assigned a tier to. Changed tools are marked unavailable until
 * someone looks at them again.
 */
export async function refreshConnectorTools(connectorCode: string): Promise<{
  added: string[];
  removed: string[];
}> {
  const session = await requirePermission("connectors:write");
  if (connectorCode === PLATFORM_CONNECTOR_CODE) {
    throw new ConnectorRejected(
      "The Platform connector's tools are the platform's own; there is nothing to refresh.",
      "أدوات موصل المنصة هي أدوات المنصة نفسها؛ لا يوجد ما يُحدَّث.",
    );
  }

  const connector = await repository.readConnector(connectorCode);
  if (!connector) throw new ConnectorRejected("That connector no longer exists.", "لم يعد هذا الموصل موجوداً.");
  // A REST API's tools are its OpenAPI document's operations; no server lists them.
  if (connector.transport === "OpenApi") {
    throw new ConnectorRejected(
      "A REST API connector's tools come from its OpenAPI document: import it again to change them. Test connection checks the API answers.",
      "أدوات موصل REST مأخوذة من مستند OpenAPI: استورده مجدداً لتغييرها. يتحقق اختبار الاتصال من استجابة الواجهة.",
    );
  }

  let discovered: DiscoveredTool[];
  try {
    // The runtime knows a connector by its code, as `runtimeConnectors` registers it.
    discovered = await viaRuntime(connector.code, () => listTools(connector.code));
  } catch (problem) {
    if (problem instanceof CredentialUnavailable) {
      await repository.setConnectorStatus(connector.id, "Error", session.personId);
      throw new ConnectorRejected(problem.message, problem.messageAr);
    }
    // `UC-54.2-07`: the connector is down. Its status says so, and the agents that depend
    // on it are the ones that will show in "Agents in error".
    await repository.setConnectorStatus(connector.id, "Error", session.personId);
    throw new ConnectorRejected(
      problem instanceof Error ? problem.message : "The connector did not answer.",
      problem instanceof Error ? problem.message : "لم يستجب الموصل.",
    );
  }

  const known = new Set(connector.tools.map((tool) => tool.name));
  const offered = new Set(discovered.map((tool) => tool.name));
  const added = discovered.filter((tool) => !known.has(tool.name)).map((tool) => tool.name);
  const removed = connector.tools.filter((tool) => !offered.has(tool.name)).map((tool) => tool.name);

  await repository.reconcileTools(
    connector.id,
    discovered.map((tool) => ({
      name: tool.name,
      description: tool.description,
      readOnlyHint: tool.readOnlyHint ?? null,
      destructiveHint: tool.destructiveHint ?? null,
      // A new tool arrives unavailable at the tier its annotations earn it, so nobody
      // calls it before an admin has decided what it is.
      tier: tierForTool(tool, connector.defaultTierForNewTools),
    })),
    session.personId,
  );
  await repository.setConnectorStatus(connector.id, "Connected", session.personId);

  await audit({
    actor: { type: "Person", id: session.personId, label: session.nameEn },
    action: "connectors:write",
    objectType: "Connector",
    objectLabel: connectorCode,
    detail: { added, removed },
  });
  return { added, removed };
}

/**
 * `UC-54.1-02` for a saved REST API connector: reach the API as a run's call would, and record
 * the result as the connector's status. Its tools are the operations its document declared.
 */
export async function testApiConnector(connectorCode: string): Promise<{ httpStatus: number; tools: { name: string; tier: string }[] }> {
  const session = await requirePermission("connectors:write");
  const connector = await repository.readConnector(connectorCode);
  if (!connector) throw new ConnectorRejected("That connector no longer exists.", "لم يعد هذا الموصل موجوداً.");
  if (connector.transport !== "OpenApi" || !connector.serverUrl) {
    throw new ConnectorRejected("That connector is not a REST API.", "هذا الموصل ليس واجهة REST.");
  }
  let httpStatus: number;
  try {
    httpStatus = await probeServer({ ...connector, serverUrl: connector.serverUrl });
  } catch (problem) {
    await repository.setConnectorStatus(connector.id, "Error", session.personId);
    if (problem instanceof OpenApiCallRejected) throw new ConnectorRejected(problem.message, problem.messageAr);
    throw problem;
  }
  // A server error is the API not working; anything else is the API answering.
  await repository.setConnectorStatus(connector.id, httpStatus >= 500 ? "Error" : "Connected", session.personId);
  return { httpStatus, tools: connector.tools };
}
