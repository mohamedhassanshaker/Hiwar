import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * What an agent reads back from the platform MCP server after a call that reached a
 * service. The server's own result has to be a valid MCP result, or the SDK refuses it
 * after the write has happened and the agent is told a successful call failed; and a
 * refusal the domain wrote has to reach the agent, or it cannot correct its next call.
 */

process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => null,
}));

type McpAnswer = {
  result?: { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  error?: { code: number; message: string };
};

describe.skipIf(!hasDatabase)("platform MCP results", () => {
  const code = `MCPR${Date.now().toString(36).slice(-5).toUpperCase()}`;
  let token = "";

  beforeAll(async () => {
    const { mintRunToken } = await import("@/lib/run-token");
    const owner = await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'");
    const agent = await testPool().query<{ id: string }>("select id from ai.agent order by code limit 1");
    token = await mintRunToken({
      kind: "model",
      runId: "22222222-2222-4222-8222-222222222222",
      agentId: agent.rows[0].id,
      personId: owner.rows[0].id,
      routes: [],
      connectors: [],
      tools: ["request_type_create", "request_type_attribute_create"],
    });
  });

  afterAll(async () => {
    await testPool().query("delete from work.request_type where code = $1", [code]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  async function call(name: string, args: Record<string, unknown>): Promise<McpAnswer> {
    const { handleMcpRequest } = await import("@/mcp/server");
    const response = await handleMcpRequest(
      new Request("http://web.awp-app.svc:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      }),
    );
    return (await response.json()) as McpAnswer;
  }

  it("answers a write whose service returns nothing with a result, and a domain refusal with its reason", async () => {
    const created = await call("request_type_create", {
      code,
      nameEn: "MCP results",
      nameAr: "نتائج",
      categoryEn: "General",
      decomposition: "None",
    });
    expect(created.result?.structuredContent).toEqual({ code });

    const attribute = { code, key: "merchant_id", labelEn: "Merchant ID", labelAr: "رقم التاجر", dataType: "Text", required: true };
    const added = await call("request_type_attribute_create", attribute);
    // The service returns nothing; the agent is told it succeeded rather than that it failed.
    expect(added.error).toBeUndefined();
    expect(added.result?.isError).toBe(false);
    expect(JSON.parse(added.result?.content[0]?.text ?? "null")).toEqual({ ok: true });

    // The same attribute again: the agent reads why, which is what tells it the first call landed.
    const again = await call("request_type_attribute_create", attribute);
    expect(again.error?.message).toMatch(/merchant_id/);
    expect(again.error?.message).not.toBe("the call failed");
  });
});
