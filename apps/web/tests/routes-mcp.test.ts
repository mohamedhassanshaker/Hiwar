import { beforeAll, describe, expect, it, vi } from "vitest";

// The server reaches the session layer, which reaches Auth.js and the Next.js request.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => null,
}));

import { POST } from "@/app/api/mcp/route";
import { mintRunToken } from "@/lib/run-token";
import { MCP_PROTOCOL_VERSION } from "@/mcp/server";

/**
 * `POST /api/mcp`, the platform MCP server's route (stack specification 4.1).
 *
 * `tests/mcp.test.ts` covers the server's rules; these cover what the mounted route answers
 * over HTTP: the status, the JSON-RPC envelope and its content type.
 */

const RUN = "11111111-1111-4111-8111-111111111111";

beforeAll(() => {
  process.env.RUN_TOKEN_SIGNING_KEY = "test-run-token-signing-key";
  process.env.AUTH_SECRET = "test";
  process.env.DATABASE_URL ??= "postgresql://awp:awp@127.0.0.1:5432/awp";
});

const call = (body: unknown, token?: string) =>
  POST(
    new Request("http://web.awp-app.svc:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

const token = (tools: string[]) =>
  mintRunToken({ kind: "model", runId: RUN, agentId: "a", personId: "p", routes: [], connectors: [], tools });

describe("POST /api/mcp", () => {
  it("answers the handshake as JSON with the protocol version the server speaks", async () => {
    const response = await call(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "0" } },
      },
      await token([]),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { jsonrpc: string; id: number; result: { protocolVersion: string } };
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: MCP_PROTOCOL_VERSION } });
  });

  it("lists the granted tools in the JSON-RPC result", async () => {
    const response = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, await token(["work_item_search"]));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: number; result: { tools: { name: string }[] } };
    expect(body.id).toBe(2);
    expect(body.result.tools.map((tool) => tool.name)).toEqual(["work_item_search"]);
  });

  it("answers a client that sends no Accept header, as Next.js hands the request to the route", async () => {
    // Next.js passes a route handler a `Proxy` around the request whose getters read the
    // target and bind its methods (`proxyNextRequest`, `ReflectAdapter`). Rebuilding the
    // request from that proxy threw, and the endpoint answered 500 with no body.
    const request = new Request("http://web.awp-app.svc:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await token(["work_item_search"])}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    });
    const proxied = new Proxy(request, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });

    const response = await POST(proxied);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: number; result: { tools: { name: string }[] } };
    expect(body.id).toBe(4);
    expect(body.result.tools.map((tool) => tool.name)).toEqual(["work_item_search"]);
  });

  it("refuses a call with no credential with a 401 JSON-RPC error that names no request", async () => {
    const response = await call({ jsonrpc: "2.0", id: 3, method: "tools/list" });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    // -32600 is JSON-RPC's Invalid Request; there is no session to answer the id in.
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "a run token or client key is required" },
    });
  });
});
