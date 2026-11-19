import { egressFetch, egressProblem } from "@/lib/egress";
import { logger } from "@/lib/logger";
import { Rejected } from "@/lib/rejection";
import { CredentialUnavailable, requestAuth, type RequestAuth } from "./credential-auth";
import type { Operation } from "./openapi";
import { openApiTarget, type OpenApiTarget, type OpenApiTargetProblem } from "./repository";

/**
 * Calls one operation of an `OpenApi` connector.
 *
 * The request is issued here rather than by the connector runtime, which speaks MCP: the
 * credential is stored encrypted against the connector row and turned into the request's
 * headers by `credential-auth.ts` (D296), and the audit entry the MCP server writes is over
 * the call that actually happened.
 */

/**
 * Thrown when a call cannot be made, with the reason the model should read and act on.
 *
 * Bilingual like every other refusal: a run answers in the language it was asked in, and
 * a tool failure is often the sentence the person actually reads.
 */
export class OpenApiCallRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "OpenApiCallRejected";
  }
}

/** Why one `connector/tool` name does not resolve, in the words the model reads. */
const WHY: Record<OpenApiTargetProblem, (connector: string, tool: string) => [string, string]> = {
  "no-connector": (connector) => [`There is no connector ${connector}.`, `لا يوجد موصل ${connector}.`],
  "not-openapi": (connector) => [`${connector} is not an OpenAPI connector.`, `${connector} ليس موصل OpenAPI.`],
  disabled: (connector) => [`${connector} is disabled.`, `${connector} معطّل.`],
  "no-server-url": (connector) => [
    `${connector} has no server URL.`,
    `لا يوجد عنوان خادم لـ ${connector}.`,
  ],
  "no-operation": (connector, tool) => [
    `${connector} has no operation ${tool}.`,
    `لا توجد عملية ${tool} في ${connector}.`,
  ],
  unavailable: (connector, tool) => [
    `${connector}/${tool} is not available.`,
    `${connector}/${tool} غير متاحة.`,
  ],
};

/** The connector and the operation a `connector/tool` name points at. */
export async function resolveOperation(connectorCode: string, toolName: string): Promise<OpenApiTarget> {
  const found = await openApiTarget(connectorCode, toolName);
  if ("problem" in found) {
    const [message, messageAr] = WHY[found.problem](connectorCode, toolName);
    throw new OpenApiCallRejected(message, messageAr);
  }
  return found.target;
}

/** The headers and query parameters this connector's credential adds to a request (D296). */
async function authorisation(connector: Pick<OpenApiTarget, "code" | "serverUrl" | "authType" | "secretRef">): Promise<RequestAuth> {
  try {
    return await requestAuth(connector);
  } catch (problem) {
    if (problem instanceof CredentialUnavailable) throw new OpenApiCallRejected(problem.message, problem.messageAr);
    throw problem;
  }
}

/** A URL with an API key's query parameter added. */
function withQuery(url: string | URL, query: Record<string, string>): URL {
  const target = new URL(url);
  for (const [name, value] of Object.entries(query)) target.searchParams.set(name, value);
  return target;
}

/** The URL and body one call produces, from the operation and the model's arguments. */
function requestOf(serverUrl: string, operation: Operation, args: Record<string, unknown>) {
  let path = operation.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};
  let body: string | undefined;

  for (const parameter of operation.parameters) {
    const value = args[parameter.name];
    if (value === undefined || value === null) {
      if (parameter.required) {
        throw new OpenApiCallRejected(
          `${operation.name} needs ${parameter.name}.`,
          `تحتاج ${operation.name} إلى ${parameter.name}.`,
        );
      }
      continue;
    }
    if (parameter.in === "path") {
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    } else if (parameter.in === "query") {
      // An array parameter repeats rather than being stringified into one value.
      for (const one of Array.isArray(value) ? value : [value]) query.append(parameter.name, String(one));
    } else if (parameter.in === "header") {
      headers[parameter.name.toLowerCase()] = String(value);
    } else {
      body = JSON.stringify(value);
    }
  }

  const unfilled = path.match(/\{[^}]+\}/g);
  if (unfilled) {
    throw new OpenApiCallRejected(
      `${operation.name} left ${unfilled.join(", ")} unfilled.`,
      `تركت ${operation.name} ${unfilled.join("، ")} بلا قيمة.`,
    );
  }

  const url = new URL(path.replace(/^\//, ""), serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`);
  url.search = query.toString();
  if (body !== undefined) headers["content-type"] = "application/json";
  return { url, headers, body };
}

/**
 * `UC-54.1-02` for a REST API: one authorised GET of the API's server URL, through the egress
 * proxy as every call is. Any HTTP answer is the API reached; its status says what it made of it.
 *
 * @throws {OpenApiCallRejected} when no answer came, with the network reason.
 */
export async function probeServer(connector: Pick<OpenApiTarget, "code" | "serverUrl" | "authType" | "secretRef">): Promise<number> {
  try {
    const auth = await authorisation(connector);
    const response = await egressFetch(withQuery(connector.serverUrl, auth.query), {
      headers: { accept: "application/json", ...auth.headers },
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    return response.status;
  } catch (problem) {
    if (problem instanceof OpenApiCallRejected) throw problem;
    const reason = egressProblem(problem);
    throw new OpenApiCallRejected(`${connector.serverUrl} could not be reached: ${reason}`, `تعذّر الوصول إلى ${connector.serverUrl}: ${reason}`);
  }
}

/** How long one operation may take before the call is abandoned. */
const CALL_TIMEOUT_MS = 30_000;

/**
 * Calls an operation `resolveOperation` returned with the model's arguments.
 *
 * @throws {OpenApiCallRejected} when the connector, the operation or the arguments do not
 * allow the call to be made. A call the API itself refuses comes back as its status and
 * body, because that is an answer the agent can act on rather than a platform failure.
 */
export async function callOperation(
  connector: OpenApiTarget,
  args: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const { code: connectorCode, toolName, operation } = connector;
  const { url, headers, body } = requestOf(connector.serverUrl, operation, args);

  const auth = await authorisation(connector);
  let response: Response;
  try {
    response = await egressFetch(withQuery(url, auth.query), {
      method: operation.method.toUpperCase(),
      headers: { accept: "application/json", ...headers, ...auth.headers },
      body,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (problem) {
    const reason = egressProblem(problem);
    logger().warn({ connector: connectorCode, tool: toolName, problem: reason }, "an OpenAPI connector call did not complete");
    throw new OpenApiCallRejected(
      `${connectorCode}/${toolName} could not be reached: ${reason}`,
      `تعذّر الوصول إلى ${connectorCode}/${toolName}: ${reason}`,
    );
  }

  const text = await response.text();
  let parsed: unknown = text;
  if (text && response.headers.get("content-type")?.includes("json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // The API said JSON and sent something else; the text is what actually arrived.
    }
  }
  return { status: response.status, ok: response.ok, body: parsed };
}
