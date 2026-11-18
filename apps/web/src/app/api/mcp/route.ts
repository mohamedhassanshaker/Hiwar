import { handleMcpRequest } from "@/mcp/server";

/**
 * The platform MCP server (stack specification 4.1). Agents reach it through
 * agentgateway; an integration client reaches it the same way with its own key
 * (specification 7.5.6).
 */

// Never cached and never prerendered: this answers a live request.
export const instant = false;

/**
 * Hands each request to the platform MCP server: 401 without a valid run token or client key in
 * `Authorization`, otherwise the JSON-RPC response for that caller.
 */
export function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
