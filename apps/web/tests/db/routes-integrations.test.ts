import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `/api/integrations/[clientCode]/agui`, the AG-UI stream an integration client reaches with
 * its own key (S-77). The client, its key and its settings are real rows; the agent service,
 * which starts the run and streams it, is answered here.
 */

const AGENT_SERVICE = "http://agent-service.test";
process.env.AGENT_SERVICE_URL = AGENT_SERVICE;
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";
process.env.APP_KEK ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

const ORIGIN = "https://partner.example";

/** Three AG-UI events, of which the client below is given the last two. */
const EVENTS = [
  'data: {"type":"RUN_STARTED","threadId":"t-1","runId":"r-1"}\n\n',
  'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m-1","delta":"Hello"}\n\n',
  'data: {"type":"RUN_FINISHED","threadId":"t-1","runId":"r-1"}\n\n',
];

describe.skipIf(!hasDatabase)("/api/integrations/[clientCode]/agui", () => {
  let adminId = "";
  let clientCode = "";
  let secret = "";
  const runs: string[] = [];
  const realFetch = globalThis.fetch;
  let started: Record<string, unknown> | null = null;

  beforeAll(async () => {
    const admin = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role_permission rp on rp.role_id = ra.role_id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code in ('integrations:write', 'agents:invoke') and rp.effect = 'Allow' and p.status = 'Active'
       group by ra.person_id having count(distinct perm.code) = 2
       order by ra.person_id limit 1`,
    );
    adminId = admin.rows[0].id;

    const { createClient, createKey, setAgui, setPermissions } = await import("@/features/integrations/service");
    signedInAs = adminId;
    clientCode = `route-client-${Date.now().toString(36)}`;
    await createClient({
      clientId: clientCode,
      nameEn: "A route test client",
      nameAr: "عميل لاختبار المسار",
      ownerPersonId: adminId,
      permissions: ["agents:invoke"],
    });
    await setPermissions({ clientCode, permissions: ["agents:invoke"], agentCodes: ["pa"] });
    await setAgui({ clientCode, enabled: true, allowedEvents: ["TEXT_MESSAGE_CONTENT", "RUN_FINISHED"], allowedOrigins: [ORIGIN] });
    secret = await createKey({ clientId: clientCode, name: "route tests", expiresInDays: null });
    signedInAs = "";
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    started = null;
    if (runs.length > 0) {
      await testPool().query("delete from ai.run where id = any($1)", [runs]);
      runs.length = 0;
    }
  });

  afterAll(async () => {
    if (clientCode) await testPool().query("delete from gov.integration_client where client_id = $1", [clientCode]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** The agent service accepts the run; its stream answers `streamStatus` with `EVENTS`. */
  function agentService(streamStatus = 200) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const address = String(url);
      if (address === `${AGENT_SERVICE}/agui/runs` && init?.method === "POST") {
        started = JSON.parse(String(init.body)) as Record<string, unknown>;
        runs.push(String(started.run_id));
        return new Response(null, { status: 202 });
      }
      if (started && address === `${AGENT_SERVICE}/agui/runs/${String(started.run_id)}/stream`) {
        if (streamStatus !== 200) return new Response("no stream", { status: streamStatus });
        return new Response(EVENTS.join(""), { headers: { "content-type": "text/event-stream" } });
      }
      throw new Error(`unexpected call to ${address}`);
    }) as typeof fetch;
  }

  const call = async (body: unknown, headers: Record<string, string>) => {
    const { POST } = await import("@/app/api/integrations/[clientCode]/agui/route");
    return POST(
      new Request(`http://console.awp.test/api/integrations/${clientCode}/agui`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ clientCode }) },
    );
  };

  it("UC-77.3-02 streams the run with only the events the client was given, to its origin", async () => {
    agentService();

    const response = await call({ agent: "pa", prompt: "Hello" }, { authorization: `Bearer ${secret}`, origin: ORIGIN });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("x-awp-run-id")).toBe(started?.run_id);
    // The upstream stream is finite here, so reading it to the end closes it.
    expect(await response.text()).toBe(EVENTS[1] + EVENTS[2]);

    // The run is the client owner's, started on the deployment surface.
    const { rows } = await testPool().query<{ created_by: string; context_type: string }>(
      "select created_by, context_type from ai.run where id = $1",
      [started?.run_id],
    );
    expect(rows).toEqual([{ created_by: adminId, context_type: "Deployment" }]);
  });

  it("UC-77.3-03 answers a preflight with the methods and headers a call may use", async () => {
    const { OPTIONS } = await import("@/app/api/integrations/[clientCode]/agui/route");

    const response = await OPTIONS(new Request(`http://console.awp.test/api/integrations/${clientCode}/agui`, { method: "OPTIONS", headers: { origin: ORIGIN } }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization, content-type");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("answers 400 when the call names no agent or no prompt, and starts nothing", async () => {
    agentService();

    for (const body of [{ prompt: "Hello" }, { agent: "pa", prompt: "  " }]) {
      const response = await call(body, { authorization: `Bearer ${secret}`, origin: ORIGIN });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ reason: "A call needs an agent and a prompt." });
    }
    expect(started).toBeNull();
  });

  it("UC-77.3-01 answers 401 to an unknown key and 403 to an origin that is not allowed", async () => {
    agentService();

    const unknown = await call({ agent: "pa", prompt: "Hello" }, { authorization: "Bearer not-a-key", origin: ORIGIN });
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("vary")).toBe("Origin");
    expect(await unknown.json()).toEqual({ reason: "The key is not valid.", refusal: "NoCredential" });

    const elsewhere = await call(
      { agent: "pa", prompt: "Hello" },
      { authorization: `Bearer ${secret}`, origin: "https://somewhere-else.example" },
    );
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.headers.get("access-control-allow-origin")).toBeNull();
    expect(await elsewhere.json()).toEqual({ reason: "This origin is not allowed.", refusal: "OriginNotAllowed" });

    const otherAgent = await call({ agent: "rec", prompt: "Hello" }, { authorization: `Bearer ${secret}`, origin: ORIGIN });
    expect(otherAgent.status).toBe(403);
    expect(await otherAgent.json()).toMatchObject({ refusal: "AgentNotAllowed" });
    expect(started).toBeNull();
  });

  it("UC-77.3-01 answers 503 with the reason when a permitted call's run cannot start", async () => {
    // Every check passes; the agent service refuses the run, so `startRun` throws `RunNotStarted`.
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === `${AGENT_SERVICE}/agui/runs` && init?.method === "POST") {
        runs.push(String((JSON.parse(String(init.body)) as { run_id: string }).run_id));
        return new Response(null, { status: 500 });
      }
      throw new Error(`unexpected call to ${String(url)}`);
    }) as typeof fetch;

    const response = await call({ agent: "pa", prompt: "Hello" }, { authorization: `Bearer ${secret}`, origin: ORIGIN });

    expect(response.status).toBe(503);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(await response.json()).toEqual({ reason: "The agent service refused the run (500).", refusal: "RunNotStarted" });
    // The row stays, as a run that failed to start.
    const { rows } = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runs[0]]);
    expect(rows).toEqual([{ status: "Failed" }]);
  });

  it("answers 503 when the run started but its stream did not open", async () => {
    agentService(502);

    const response = await call({ agent: "pa", prompt: "Hello" }, { authorization: `Bearer ${secret}`, origin: ORIGIN });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: "The assistant is unavailable." });
  });
});
