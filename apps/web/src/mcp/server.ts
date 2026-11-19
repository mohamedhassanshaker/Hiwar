import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { insertAuditEntry } from "@/db/queries/audit";
import { spendApproval, type ApprovalClaimFailure } from "@/features/agents/run-service";
import { authenticateClient, recordClientRefusal } from "@/features/integrations/service";
import { readFloorForRun } from "@/features/rooms/service";
import {
  APPROVAL_ARGUMENT,
  ApprovalRequired,
  argumentsHash,
  targetVersion,
} from "@/lib/approval-binding";
import { logger } from "@/lib/logger";
import { Rejected } from "@/lib/rejection";
import { NotPermitted, runAs } from "@/lib/session";
import { verifyRunToken, type RunTokenKind } from "@/lib/run-token";
import { callOperation, resolveOperation } from "@/features/connectors/openapi-call";
import { grantedConnectorTools, viaRuntime } from "@/features/connectors/service";
import { modelToolName, platformToolName } from "@/features/connectors/tool-name";
import { callConnectorTool, listTools } from "@/lib/connector-runtime";
import { inputSchemaOf } from "./action-tool";
import { PLATFORM_TOOLS, TOOLS_BY_NAME } from "./tools";

/**
 * The platform MCP server (stack specification 4.1 and 4.3.4), spoken over Streamable
 * HTTP and published to agents through agentgateway.
 *
 * It is the only way the agent service changes domain data. A call carries the run token
 * the console minted; the person it names becomes the acting principal for the call, so
 * the service behind each tool runs the permission check and the audit it already has.
 * The agent is recorded as the caller on top of that, which is what the Audit screen
 * shows as "T2 tool …".
 *
 * The protocol itself — the JSON-RPC envelope, `initialize` and its version negotiation,
 * `ping`, batching, the error codes — belongs to `@modelcontextprotocol/sdk` (D86). What
 * is written here is only what the platform decides: who is calling, which tools that
 * caller may see, and whether this particular call may run.
 */

/**
 * Who is calling: the harness with a run token, or an integration client with its own key.
 *
 * A run token names the agent and the person it acts for, and the services behind each tool
 * run their own permission check against that person. A client has no person: its own
 * permission list is what bounds it, and it may only reach the tools it was exposed.
 */
export type McpCaller =
  | { kind: "Agent"; agentId: string; personId: string; runId: string; tools: string[]; token: RunTokenKind }
  | { kind: "Client"; client: Awaited<ReturnType<typeof authenticateClient>> extends infer T ? NonNullable<T> : never };

/** The newest MCP revision this server speaks; older clients get the one they ask for. */
export const MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

/** Not a JSON-RPC code: MCP uses it for a tool the caller may not run. */
const NOT_PERMITTED = -32001;

/**
 * The structured reasons a call is refused, each the prefix of a `NotPermitted.reason`.
 *
 * An agent has to explain a refusal to the person it acts for, and the four are four
 * different sentences: ask an administrator for the tool, you are not allowed to do this,
 * that is not your run, someone has to agree to this first. A reason arriving without one
 * of these prefixes is the acting person's own permissions.
 */
export const REASON_CODES = ["agent_grant:", "run_binding:", "approval_required:"] as const;

/**
 * A refusal in the shape the protocol layer forwards: it reads `code` and `data` off
 * whatever a handler throws.
 *
 * `McpError` is not used because it rewrites the message as "MCP error <code>: …", and the
 * message is a contract here — an integration client is answered the bare "not permitted",
 * and an agent reads its reason code out of the same string.
 */
function refused(code: number, message: string, data?: unknown): Error {
  return Object.assign(new Error(message), { code, ...(data === undefined ? {} : { data }) });
}

/** The catalogue, in the shape `tools/list` returns, bounded by what the caller may see. */
async function catalogue(caller: McpCaller) {
  const visible =
    caller.kind === "Agent"
      ? // An agent holds what its configuration granted it and nothing else. A token
        // minted before this claim existed carries no list; such a run is offered nothing
        // rather than everything, because the safe reading of "unknown grant" is "none".
        //
        // A harness token lists nothing at all: its tools are the run's own plumbing, and
        // the model is never to be told they exist.
        (caller.token === "harness" ? [] : PLATFORM_TOOLS.filter((entry) => caller.tools.includes(entry.name)))
      : PLATFORM_TOOLS.filter((entry) => caller.client.mcp.exposedTools.includes(entry.name));
  return {
    tools: [
      ...visible.map((entry) => ({
        name: entry.name,
        description: entry.description,
        // The action's own schema, not an empty object: a model told only `{}` has to guess
        // field names and learn them from rejections, which is fatal to a bulk mission that
        // must be written correctly the first time.
        inputSchema: inputSchemaOf(entry) as Tool["inputSchema"],
        annotations: {
          // The harness reads the tier from the platform's own catalogue, not from the
          // agent's configuration, so an agent cannot lower it (specification 7.4.5).
          readOnlyHint: entry.tier === "T0",
          destructiveHint: entry.tier === "T2",
          "awp/tier": entry.tier,
          "awp/permission": entry.permission,
        },
      })),
      ...(caller.kind === "Agent" && caller.token === "model" ? await connectorCatalogue(caller.tools) : []),
    ],
  };
}

/**
 * The connector tools a run's grant names, listed under their model names (D223).
 *
 * An `OpenApi` operation's schema is stored with it. An MCP server owns its tools' schemas,
 * so they are read from the connector runtime when the run lists its tools; a connector that
 * does not answer still has its tools listed, with an open schema, and the call reports why.
 */
async function connectorCatalogue(granted: string[]): Promise<Tool[]> {
  const rows = (await grantedConnectorTools(granted)).filter((row) => row.isEnabled && row.isAvailable);
  const mcpCodes = [...new Set(rows.filter((row) => row.transport !== "OpenApi").map((row) => row.code))];
  const schemas = new Map(
    await Promise.all(
      mcpCodes.map(async (code) => {
        try {
          const tools = await viaRuntime(code, () => listTools(code));
          return [code, new Map(tools.map((tool) => [tool.name, tool.inputSchema]))] as const;
        } catch (problem) {
          const reason = problem instanceof Error ? problem.message : String(problem);
          logger().warn({ problem: reason, connector: code }, "connector tools listed without their schemas");
          return [code, new Map<string, Record<string, unknown> | undefined>()] as const;
        }
      }),
    ),
  );
  return rows.map((row) => ({
    name: modelToolName(`${row.code}/${row.name}`),
    description: row.description ?? "",
    inputSchema: ((row.transport === "OpenApi"
      ? (row.operation as { parametersJsonSchema?: Record<string, unknown> } | null)?.parametersJsonSchema
      : schemas.get(row.code)?.get(row.name)) ?? { type: "object" }) as Tool["inputSchema"],
    annotations: {
      readOnlyHint: row.tier === "T0",
      destructiveHint: row.tier === "T2",
      "awp/tier": row.tier,
    },
  }));
}

/** One MCP connector's tool, forwarded to the connector runtime; its failure is the model's to read. */
async function forwardToConnector(
  code: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    const result = await viaRuntime(code, () => callConnectorTool(code, tool, args));
    return { status: 200, body: result.structured ?? result.content };
  } catch (problem) {
    if (problem instanceof Rejected) throw problem;
    const message = problem instanceof Error ? problem.message : `${code}/${tool} failed`;
    throw new Rejected(message, message);
  }
}

/**
 * `UC-54.1-09`: an `OpenApi` connector's operations are rows, not entries in this
 * module's static catalogue, so they are resolved by name at call time.
 *
 * They are served here rather than by the connector runtime because the credential is
 * stored against the connector row in this application, encrypted; the runtime is handed
 * references to mounted Secrets, never values.
 */
async function callConnectorOperation(name: string, args: unknown, caller: McpCaller): Promise<CallToolResult> {
  if (caller.kind !== "Agent") {
    throw new NotPermitted("connectors:read", "Only a run may call a connector operation.");
  }
  // The grant (D30) and the approval backstop (D49) hold for a connector operation as for a
  // catalogue tool: the operation's name is what the run's configuration granted.
  if (!caller.tools.includes(name)) {
    throw new NotPermitted("connectors:read", `agent_grant: ${name} is not granted to this agent.`);
  }
  const [connectorCode, ...rest] = name.split("/");
  const toolName = rest.join("/");
  if (!connectorCode || !toolName) throw refused(ErrorCode.MethodNotFound, `no such tool: ${name}`);

  // An MCP connector's tool goes to the connector runtime, which holds the session to its
  // server; an `OpenApi` operation is issued here (D223).
  const [listed] = await grantedConnectorTools([name]);
  const mcp = listed && listed.transport !== "OpenApi" ? listed : null;
  if (mcp && !mcp.isEnabled) throw new Rejected(`${connectorCode} is disabled.`, `${connectorCode} معطّل.`);
  if (mcp && !mcp.isAvailable) throw new Rejected(`${name} is not available.`, `${name} غير متاحة.`);
  const operation = mcp ? null : await resolveOperation(connectorCode, toolName);
  const tier = operation?.tier ?? mcp?.tier ?? "T2";
  const sent = (args ?? {}) as Record<string, unknown>;
  // The approval reference is the platform's, never a parameter of the API being called.
  const withoutApproval = withoutApprovalReference(sent);
  const approvalKey = tier === "T2" ? await requireApproval(name, sent, [], caller) : undefined;

  const result = await runAs(
    caller.personId,
    { id: caller.agentId, label: name, runId: caller.runId },
    () => (operation ? callOperation(operation, withoutApproval) : forwardToConnector(connectorCode, toolName, withoutApproval)),
    approvalKey ? { approvalKey } : {},
  );

  await insertAuditEntry({
    actorType: "Agent",
    actorId: caller.agentId,
    actorLabel: name,
    action: `mcp:${name}`,
    objectType: "ConnectorTool",
    objectId: null,
    objectLabel: name,
    // The platform allowed the call; what the API answered is its status.
    detailJson: { onBehalfOf: caller.personId, status: result.status, tier },
    outcome: "Allowed",
  });

  return {
    // An empty body (a 204) still has to be text; the status is what it says.
    content: [
      { type: "text", text: typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? { status: result.status }) },
    ],
    ...(result.body && typeof result.body === "object" && !Array.isArray(result.body)
      ? { structuredContent: result.body as Record<string, unknown> }
      : {}),
    // An API that answered 4xx has answered: the agent reads the status and the body and
    // decides, rather than being told the platform failed.
    isError: false,
  };
}

/**
 * The plumbing tools, and the argument of each that has to name the caller's own run.
 *
 * Every one of them takes a run id, and until now nothing checked it against the token
 * presenting it: one run's harness could record an approval against another run, answer
 * its question, or finish it outright. The token names its run, so the argument has to
 * agree with it.
 *
 * `run_start` is the exception in shape, not in kind. It registers a *new* run, so its
 * `run_id` is deliberately not the caller's; what has to be the caller's is the run the
 * delegation comes from, which is also what bounds the depth of a delegation chain.
 */
const RUN_BOUND_ARGUMENT: Record<string, string> = {
  approval_create: "run_id",
  agent_question_create: "run_id",
  run_finish: "run_id",
  run_token_refresh: "run_id",
  run_start: "parent_run_id",
};

/** A call's arguments without the approval reference a retry presents (`APPROVAL_ARGUMENT`). */
function withoutApprovalReference(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== APPROVAL_ARGUMENT));
}

/** Why a claim failed, as the sentence the agent repeats to the person. */
const CLAIM_REASONS: Record<ApprovalClaimFailure, string> = {
  no_such_approval: "there is no such approval",
  not_approved: "that approval has not been decided yet",
  already_used: "that approval has already been used once",
  expired: "that approval has expired",
  wrong_run: "that approval belongs to another run",
  wrong_tool: "that approval was given for a different tool",
  arguments_changed: "the arguments are not the ones that were approved",
  record_changed: "the record has changed since it was approved",
};

/**
 * Spend a bound approval and return its key, or refuse the call.
 *
 * The refusal carries the descriptor the harness needs to create the right approval and
 * retry the identical call: which tool, which arguments by hash, and which record version.
 * Nothing has been written at this point and nothing will be.
 */
async function requireApproval(
  toolName: string,
  args: unknown,
  fields: string[],
  caller: Extract<McpCaller, { kind: "Agent" }>,
): Promise<string> {
  const hash = argumentsHash(args);
  const version = targetVersion(args);
  const reference = (args as Record<string, unknown>)[APPROVAL_ARGUMENT];

  const refuse = (why: string): never => {
    throw new ApprovalRequired({
      tool: toolName,
      argumentsHash: hash,
      expectedVersion: version,
      fields,
      reasons: [why],
    });
  };

  if (typeof reference !== "string" || reference.length === 0) {
    refuse(`${toolName} needs an approval decided by a person before it runs`);
  }

  const claim = await spendApproval({
    approvalId: reference as string,
    runId: caller.runId,
    toolName,
    argumentsHash: hash,
    targetVersion: version,
  });
  if (!claim.ok) return refuse(CLAIM_REASONS[claim.reason]);
  return claim.key;
}

/**
 * Runs one `tools/call` for a settled caller.
 *
 * A connector name goes to `callConnectorOperation`. A catalogue tool is checked in order: the
 * agent's grant (D30) or the client's exposure, permissions and owner; the arguments against the
 * tool's schema; the run binding of plumbing tools; and the approval backstop for a T2 or
 * escalated call (D49, D58), which spends the bound approval. The tool's service then runs as the
 * acting person (the agent's person, or the client's owner) with the room read floor on T0 reads
 * (D104), and the call is audited as Allowed. Returns the result as JSON text and, for an object,
 * as `structuredContent`. Throws on any refusal; `serverFor` turns it into the protocol error.
 */
async function callTool(params: CallToolRequest["params"], caller: McpCaller): Promise<CallToolResult> {
  const { arguments: args } = params;
  // A connector tool arrives under the name it was listed by (D223).
  const name = platformToolName(params.name);
  const entry = TOOLS_BY_NAME.get(name);
  if (!entry && name.includes("/")) return callConnectorOperation(name, args, caller);
  if (!entry) throw refused(ErrorCode.MethodNotFound, `no such tool: ${name}`);

  // `UC-77.4-02`: a client reaches only the tools it was exposed, and only the permissions
  // it was granted. Both are checked here, before the tool's own service runs.
  // The same bound on the call itself, not only on the listing: a name the model learned
  // some other way is still refused here. The plumbing lives on the harness token, so a
  // model token presenting `run_finish` is refused whatever the model thinks it knows.
  if (caller.kind === "Agent" && !caller.tools.includes(entry.name)) {
    throw new NotPermitted(entry.permission, `agent_grant: ${entry.name} is not granted to this agent.`);
  }

  if (caller.kind === "Client") {
    if (!caller.client.mcp.enabled) throw new NotPermitted(entry.permission, "MCP access is off for this client.");
    if (!caller.client.mcp.exposedTools.includes(entry.name)) {
      throw new NotPermitted(entry.permission, `${entry.name} is not exposed to this client.`);
    }
    if (!caller.client.permissions.includes(entry.permission)) {
      throw new NotPermitted(entry.permission, `This client may not ${entry.permission}.`);
    }
    if (!caller.client.ownerPersonId) throw new NotPermitted(entry.permission, "This client has no owner to act for.");
  }

  // The approval reference is how a retry presents its approval, not part of the call: it
  // is stripped before validation, because a tool's own schema is strict and knows nothing
  // about it, and hashed out of the binding for the same reason.
  const sent = (args ?? {}) as Record<string, unknown>;
  const withoutApproval = withoutApprovalReference(sent);
  const parsed = entry.input.safeParse(withoutApproval);
  if (!parsed.success) {
    throw refused(ErrorCode.InvalidParams, parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  // The run binding, checked after parsing so the argument read here is the one the tool
  // will act on. A token that names no run — one minted before the claim existed — reaches
  // none: an in-flight run at deploy is drained, not exempted.
  const boundArgument = RUN_BOUND_ARGUMENT[entry.name];
  if (caller.kind === "Agent" && boundArgument) {
    const claimed = (parsed.data as Record<string, unknown>)[boundArgument];
    if (!caller.runId || claimed !== caller.runId) {
      throw new NotPermitted(
        entry.permission,
        `run_binding: ${entry.name} acts only on the run its token was minted for.`,
      );
    }
  }

  // The approval backstop (D49). A T2 call changes something a person has to have agreed
  // to, and the agreement has to be to *this* call: the tool, these arguments, this
  // version of the record. Checked here, before the tool's service runs, so a call that
  // cannot show one has written nothing — which is what makes the harness's pause and
  // retry safe. The harness's own tier policy pauses first; this is what makes the claim
  // "the server refuses" true rather than a convention the harness observes.
  // A tool declares its base tier and the server escalates per field (D58), so what needs
  // an approval is the tier *or* what this particular payload touches.
  const escalated = caller.kind === "Agent" ? ((await entry.escalates?.(parsed.data, caller.personId)) ?? []) : [];
  const approvalKey =
    caller.kind === "Agent" && (entry.tier === "T2" || escalated.length > 0)
      ? // Hashed from what was sent, not from what validation produced: the approval was
        // created from the arguments the model wrote, and defaults applied here would make
        // every retry look like a different call.
        await requireApproval(entry.name, sent, escalated, caller)
      : undefined;

  // A client acts for the person who owns it, so the services behind each tool still run
  // the permission check and the audit they already have.
  const actingPersonId = caller.kind === "Agent" ? caller.personId : (caller.client.ownerPersonId as string);
  const actorId = caller.kind === "Agent" ? caller.agentId : caller.client.clientId;

  // A read made inside a room is bounded by what every human member may see, because the
  // answer is posted to all of them (decision (f), D104). Read-class only: a write is the
  // requester's, as the decision says. The tier comes from the platform's catalogue, not
  // from a guess at what the tool does. Empty for every run outside a room, for a read of
  // what the agent itself is granted (D291), and for the harness token's plumbing, which
  // records the run rather than reading anything into the answer (D360).
  const readFloor =
    caller.kind === "Agent" && caller.token === "model" && entry.tier === "T0" && !entry.agentGranted
      ? await readFloorForRun(caller.runId)
      : [];

  // The approval was claimed above, so the service behind the tool is told what a person
  // agreed to rather than being asked to trust the caller.
  // The run id travels with an agent so a service can bind what it allows to the record the
  // run is about, as a request step action does.
  const result = await runAs(
    actingPersonId,
    { id: actorId, label: name, ...(caller.kind === "Agent" ? { runId: caller.runId } : {}) },
    () => entry.run(parsed.data as never),
    { approvedFields: escalated, readFloor, ...(approvalKey ? { approvalKey } : {}) },
  );

  await insertAuditEntry({
    actorType: caller.kind === "Agent" ? "Agent" : "Client",
    actorId,
    actorLabel: entry.name,
    action: `mcp:${entry.name}`,
    objectType: "Tool",
    objectId: null,
    objectLabel: entry.name,
    detailJson: { tier: entry.tier, onBehalfOf: actingPersonId },
    outcome: "Allowed",
  });

  // Both shapes: the text is what a model reads, and `structuredContent` is what a caller
  // reads a field out of. Without the second, every id this server returns reaches the
  // harness as a JSON string it would have to parse itself. A service that returns nothing
  // has succeeded, and says so: `JSON.stringify(undefined)` is no text at all, which the SDK
  // refuses as an invalid result after the write has already happened.
  const body = result === undefined ? { ok: true } : result;
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    ...(body && typeof body === "object" && !Array.isArray(body)
      ? { structuredContent: body as Record<string, unknown> }
      : {}),
    isError: false,
  };
}

/** A refused or failed call, audited when it was a permission that stopped it. */
async function refusal(
  params: CallToolRequest["params"],
  problem: unknown,
  caller: McpCaller,
): Promise<Error> {
  // A call that needs a person's agreement and does not have one. Refused before anything
  // was written — by the backstop above for a T2 tool, or by a service that escalated the
  // call because of a field the patch touches (D58) — so the harness can pause, create the
  // bound approval, and retry the identical call. The descriptor is what it binds to.
  if (problem instanceof ApprovalRequired) {
    const descriptor = {
      ...problem.descriptor,
      // A service throwing this knows the fields but not the wire arguments; the hash is
      // taken here, where they are, so both paths bind the same way.
      argumentsHash: problem.descriptor.argumentsHash || argumentsHash(params.arguments ?? {}),
    };
    await insertAuditEntry({
      actorType: caller.kind === "Agent" ? "Agent" : "Client",
      actorId: caller.kind === "Agent" ? caller.agentId : caller.client.clientId,
      actorLabel: descriptor.tool,
      action: `mcp:${descriptor.tool}`,
      objectType: "Tool",
      objectId: null,
      objectLabel: descriptor.tool,
      detailJson: { reason: "approval_required", fields: descriptor.fields },
      outcome: "Denied",
    });
    return refused(
      NOT_PERMITTED,
      `${problem.message} approval_required: ${descriptor.reasons.join("; ")}`.trim(),
      descriptor,
    );
  }
  if (problem instanceof NotPermitted) {
    if (caller.kind === "Client") {
      await recordClientRefusal(caller.client, "mcp:tools/call", { reason: problem.reason, tool: params.name });
    } else {
      await insertAuditEntry({
        actorType: "Agent",
        actorId: caller.agentId,
        actorLabel: "tools/call",
        action: "mcp:tools/call",
        objectType: "Tool",
        objectId: null,
        objectLabel: params.name,
        detailJson: { reason: problem.reason, onBehalfOf: caller.personId },
        outcome: "Denied",
      });
    }
    // An agent is told why: the run acts with the asking person's permissions, so a
    // refusal is "you may not do this" and the agent has to say that back plainly rather
    // than retrying against a wall. An integration client keeps the bare answer — it is a
    // third party, and what it may reach is not something to enumerate for it.
    // A structured code, because the agent has to explain the right thing. `agent_grant`
    // is "your configuration does not include this tool"; `run_binding` is "that is not
    // your run"; `approval_required` is "a person has to agree to this exact call first".
    // Anything arriving without one of them is the acting person's own permissions, which
    // is a different sentence entirely.
    const code = REASON_CODES.some((prefix) => problem.reason.startsWith(prefix)) ? "" : "user_permission: ";
    return caller.kind === "Agent"
      ? refused(NOT_PERMITTED, `${problem.message}. ${code}${problem.reason}`.trim())
      : refused(NOT_PERMITTED, "not permitted");
  }
  // A refusal the domain wrote for a person ("an attribute named merchant_id already
  // exists") is exactly what the caller needs to correct its next call, so it is handed
  // back rather than collapsed into an internal error.
  if (problem instanceof Rejected) return refused(ErrorCode.InvalidParams, problem.message);
  const code = (problem as { code?: number }).code ?? ErrorCode.InternalError;
  const text = problem instanceof Error ? problem.message : "the call failed";
  if (code === ErrorCode.InternalError) logger().error({ err: problem, tool: params.name }, "mcp call failed");
  // Nothing internal is handed back: the agent gets the code and a short reason.
  return refused(code, code === ErrorCode.InternalError ? "the call failed" : text);
}

/**
 * One server and one transport per request.
 *
 * The caller is settled before either exists, so the two handlers close over it instead of
 * the protocol layer carrying it; and the transport is stateless, because this endpoint
 * holds nothing between requests that a session id would identify.
 */
function serverFor(caller: McpCaller): Server {
  const server = new Server(
    { name: "awp-platform", version: "0.1.0" },
    { capabilities: { tools: { listChanged: false } } },
  );
  // Cast because the entries carry `awp/tier` and `awp/permission` alongside the standard
  // annotation hints, which the SDK's own type does not name.
  server.setRequestHandler(ListToolsRequestSchema, async () => (await catalogue(caller)) as ListToolsResult);
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callTool(request.params, caller);
    } catch (problem) {
      throw await refusal(request.params, problem, caller);
    }
  });
  return server;
}

/**
 * Streamable HTTP has a client declare it accepts both JSON and an SSE stream, and the
 * transport answers 406 to a POST that does not.
 *
 * This server only ever answers JSON, so the header selects nothing here, and holding
 * callers to it would turn the console's own connection test and every integration client
 * posting a plain JSON body into a refusal. The header is supplied for them. `content-type`
 * is not, because that one says what the body is, which parsing depends on.
 *
 * Built from the request's parts, not with `new Request(request, …)`: a route handler gets
 * Next.js's `Proxy` around the request, and undici refuses a proxy as the input request
 * ("Cannot read private member #state"). The body is passed on as a stream, so the
 * transport's own size limit still applies.
 */
function streamable(request: Request): Request {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("application/json") && accept.includes("text/event-stream")) return request;
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json, text/event-stream");
  // Node's fetch requires `duplex` for a streamed body; TypeScript's DOM `RequestInit` does not name it.
  const init: RequestInit & { duplex: "half" } = { method: request.method, headers, body: request.body, duplex: "half", signal: request.signal };
  return new Request(request.url, init);
}

/** No credential, so there is no MCP session to answer in: the JSON-RPC error carries the 401. */
function unauthorized(why: string): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: ErrorCode.InvalidRequest, message: why } },
    { status: 401 },
  );
}

/**
 * The route handler. The credential decides the caller, and the SDK's transport does the
 * rest: body, batching, the JSON-RPC envelope and the response.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return unauthorized("a run token or client key is required");

  const caller = await callerFor(token);
  if (!caller) return unauthorized("the credential is not valid");

  const server = serverFor(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(streamable(request));
  } finally {
    await server.close();
  }
}

/** A run token first, then a client key: one credential, one caller. */
async function callerFor(token: string): Promise<McpCaller | null> {
  try {
    const claims = await verifyRunToken(token);
    if (claims.personId) {
      return {
        kind: "Agent",
        agentId: claims.agentId,
        personId: claims.personId,
        runId: claims.runId,
        tools: claims.tools,
        token: claims.kind,
      };
    }
  } catch {
    // Not a run token, so it may be a client key.
  }
  const client = await authenticateClient(token);
  return client ? { kind: "Client", client } : null;
}
