import { env } from "./env";

/**
 * The connector runtime, which is how this platform reaches an MCP server (S-54).
 *
 * The console never speaks MCP itself. A connector is configured here, handed to the
 * runtime, and every call to it — the handshake that lists its tools, and later every tool
 * call an agent makes — goes through that one service. Keeping the protocol in one place is
 * what makes "the connector went down" a single thing to observe rather than a failure mode
 * in two codebases.
 */

/** One operation of an `openapi` connector, as the runtime calls it. */
export type RuntimeOperation = {
  name: string;
  method: string;
  path: string;
  description: string;
  parameters: { name: string; in: string; required: boolean }[];
  parameters_json_schema: Record<string, unknown>;
};

/** A connector as the runtime's own `ConnectorSpec` names it. */
export type RuntimeConnector = {
  connector_id: string;
  name: string;
  transport: "stdio" | "http" | "openapi";
  command?: string[];
  args?: string[];
  url?: string;
  env_from_secret?: string;
  allowed_domains?: string[];
  enabled?: boolean;
  /** `openapi` only: the operations parsed from its specification document. */
  operations?: RuntimeOperation[];
  /**
   * D296: what an HTTP connector's requests carry for its credential. The runtime holds them in
   * memory only, never in the configuration it keeps for a restart, and never returns them.
   */
  headers?: Record<string, string>;
  /** An API key sent as a query parameter, kept like `headers`. */
  query?: Record<string, string>;
  /** Kept across a restart, so a runtime that lost `headers` says so rather than calling without them. */
  needs_credential?: boolean;
};

/** D296: the runtime no longer holds a connector's credential, after a restart; send the set again. */
export class RuntimeCredentialMissing extends Error {
  constructor(readonly connectorId: string) {
    super(`The connector runtime holds no credential for ${connectorId}.`);
    this.name = "RuntimeCredentialMissing";
  }
}

/**
 * One tool the server offers, as the handshake reports it.
 *
 * The two hints are the MCP annotations the server set on the tool; they decide the tier it
 * starts at. `null` means the server said nothing, which is not the same as "safe".
 */
export type DiscoveredTool = {
  name: string;
  description: string;
  readOnlyHint?: boolean | null;
  destructiveHint?: boolean | null;
  /** The JSON Schema of the tool's arguments, as the server declares it. */
  inputSchema?: Record<string, unknown>;
};

function base(): string {
  const url = env().CONNECTOR_RUNTIME_URL;
  if (!url) throw new Error("CONNECTOR_RUNTIME_URL is not set; no connector can be reached");
  return url.replace(/\/$/, "");
}

/**
 * Hand the runtime the whole set of connectors.
 *
 * The runtime replaces rather than merges, which is deliberate: it is the configuration of
 * this platform's connectors, not a queue of changes, and a partial update would leave the
 * two disagreeing about what exists.
 */
export async function reloadConnectors(connectors: RuntimeConnector[]): Promise<void> {
  const response = await fetch(`${base()}/connectors`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ connectors }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`The connector runtime refused the configuration (${response.status}).`);
  }

  // A stdio connector runs as its own workload, and one the runtime could not create is
  // not configured whatever the 200 says. Reporting success here would show the connector
  // Connected and leave the admin to discover it from a DNS error at the handshake.
  const body = (await response.json().catch(() => ({}))) as { failed?: Record<string, string> };
  const failed = Object.entries(body.failed ?? {});
  if (failed.length) {
    throw new Error(failed.map(([id, reason]) => `${id}: ${reason}`).join("; "));
  }
}

/**
 * `UC-54.1-02`: the handshake. Lists the tools one connector offers.
 *
 * @throws {Error} when the server cannot be reached, authenticated with, or spoken to —
 *   which `UC-54.1-05` turns into "adding is allowed only as Disabled".
 */
export async function listTools(connectorId: string): Promise<DiscoveredTool[]> {
  const response = await fetch(`${base()}/mcp/${encodeURIComponent(connectorId)}/tools`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 409) throw new RuntimeCredentialMissing(connectorId);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail.slice(0, 200) || `The handshake failed (${response.status}).`);
  }
  const body = (await response.json()) as { tools?: DiscoveredTool[] };
  return body.tools ?? [];
}

/**
 * Call one tool on one connector.
 *
 * A storyline Tool step names `connector/tool`; the step runs the call itself rather than
 * asking a model to, which is what makes a Strict storyline deterministic.
 *
 * @throws {Error} when the runtime, the connector or the tool refuses the call.
 */
export async function callConnectorTool(
  connectorId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string; structured: unknown }> {
  const response = await fetch(`${base()}/mcp/${encodeURIComponent(connectorId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 409) throw new RuntimeCredentialMissing(connectorId);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(connectorRefusal(detail) || `${name} failed (${response.status}).`);
  }
  const body = (await response.json()) as { content?: string; structured?: unknown };
  return { content: body.content ?? "", structured: body.structured ?? null };
}

/** How much of a refused tool call's answer a run is handed. */
export const CONNECTOR_REFUSAL_CHARS = 4000;

/**
 * What the tool answered when it refused the call: the runtime's `detail`, which is the tool's
 * own text. Cut at 200 characters, an API's validation errors never reached the model, which
 * retried the same call 40 times (owner, 2026-11-03).
 */
export function connectorRefusal(responseText: string): string {
  let said = responseText;
  try {
    const parsed = JSON.parse(responseText) as { detail?: unknown };
    if (typeof parsed.detail === "string") said = parsed.detail;
  } catch {
    // Not the runtime's JSON (a proxy's error page, say): the text is all there is.
  }
  return said.slice(0, CONNECTOR_REFUSAL_CHARS);
}
