import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * The two browser-facing agent routes: `POST /api/agui/[agentCode]`, which starts a run and
 * streams its AG-UI events back (`UC-03.1-01`), and `/api/copilotkit`, the CopilotKit
 * runtime that registers the agents a request may use (stack specification 4.3.2).
 *
 * The agent service is the boundary: its two calls, starting a run and opening its stream,
 * are answered here. The run row, the agent configuration and the permissions are real.
 */

const AGENT_SERVICE = "http://agent-service.test";
process.env.AGENT_SERVICE_URL = AGENT_SERVICE;
process.env.RUN_TOKEN_SIGNING_KEY ??= "test-run-token-signing-key-at-least-32-chars";
// The runtime reports instance creation to CopilotKit's telemetry service otherwise.
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

const FIRST_EVENT = 'data: {"type":"RUN_STARTED","threadId":"t-1","runId":"r-1"}\n\n';

describe.skipIf(!hasDatabase)("the agent routes", () => {
  let ownerId = "";
  /** An Auditor, who holds no `agents:invoke`. */
  let auditorId = "";
  const realFetch = globalThis.fetch;
  const runs: string[] = [];

  /** What the route sent the agent service, and whether the stream it was handed was let go. */
  let started: Record<string, unknown> | null = null;
  let streamCancelled = false;

  beforeAll(async () => {
    const idOf = async (email: string) =>
      (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;
    ownerId = await idOf("mariam@tahseel.ae");
    auditorId = await idOf("hessa@tahseel.ae");
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    signedInAs = "";
    started = null;
    streamCancelled = false;
    if (runs.length > 0) {
      await testPool().query("delete from ai.run where id = any($1)", [runs]);
      runs.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /**
   * The agent service: it accepts the run, and its stream answers `streamStatus` with one
   * event and then stays open, the way a live run does.
   */
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
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(FIRST_EVENT));
            },
            cancel() {
              streamCancelled = true;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      throw new Error(`unexpected call to ${address}`);
    }) as typeof fetch;
  }

  const ask = async (agentCode: string, body: unknown) => {
    const { POST } = await import("@/app/api/agui/[agentCode]/route");
    return POST(
      new Request(`http://console.awp.test/api/agui/${agentCode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ agentCode }) },
    );
  };

  describe("POST /api/agui/[agentCode]", () => {
    it("UC-03.1-01 starts a run and passes its AG-UI stream through, uncached, naming the run", async () => {
      signedInAs = ownerId;
      agentService();

      const response = await ask("pa", {
        messages: [{ role: "user", content: "What needs my attention today?" }],
        forwardedProps: { screen: "/dashboard" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-accel-buffering")).toBe("no");
      const runId = response.headers.get("x-awp-run-id");
      expect(runId).toBe(started?.run_id);

      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe(FIRST_EVENT);
      await reader.cancel();
      // Letting go of the panel's stream lets go of the agent service's as well.
      expect(streamCancelled).toBe(true);

      // The run the header names is the one recorded for this person and this agent, on the
      // panel's own surface rather than one the body could have claimed.
      const { rows } = await testPool().query<{ status: string; created_by: string; code: string; context_type: string }>(
        `select r.status, r.created_by, a.code, r.context_type from ai.run r join ai.agent a on a.id = r.agent_id where r.id = $1`,
        [runId],
      );
      expect(rows).toEqual([{ status: "Running", created_by: ownerId, code: "pa", context_type: "Console" }]);
      expect(started).toMatchObject({ context_id: "/dashboard", task: { description: "What needs my attention today?" } });
    });

    it("sends the panel's own transcript as the conversation, without empty or unknown turns", async () => {
      signedInAs = ownerId;
      agentService();

      const response = await ask("pa", {
        messages: [{ role: "user", content: "Which projects are late?" }],
        forwardedProps: {
          history: [
            { role: "user", text: "Hello" },
            { role: "assistant", text: "  " },
            { role: "tool", text: "a tool result" },
            { role: "assistant", text: "Hello. What do you need?" },
            { role: "user", text: " Which projects are late? " },
          ],
        },
      });
      await response.body?.cancel();

      expect(started?.conversation).toEqual([
        { role: "user", author: "", text: "Hello" },
        { role: "assistant", author: "", text: "Hello. What do you need?" },
        { role: "user", author: "", text: "Which projects are late?" },
      ]);
    });

    it("answers 400 and starts nothing when no question was typed", async () => {
      signedInAs = ownerId;
      agentService();

      const response = await ask("pa", { messages: [{ role: "assistant", content: "How can I help?" }] });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Ask a question first." });
      expect(started).toBeNull();
    });

    it("COM-07 answers 403 to a person who may not invoke agents", async () => {
      signedInAs = auditorId;
      agentService();

      const response = await ask("pa", { messages: [{ role: "user", content: "Hello" }] });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "You cannot use this assistant." });
      expect(started).toBeNull();
    });

    it("UC-03.1-05 answers 503 with the reason when the agent cannot start a run", async () => {
      const paused = await testPool().query<{ code: string }>("select code from ai.agent where status = 'Paused' order by code limit 1");
      signedInAs = ownerId;
      agentService();

      const response = await ask(paused.rows[0].code, { messages: [{ role: "user", content: "Hello" }] });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: `${paused.rows[0].code} is paused and cannot start a run.` });
      expect(started).toBeNull();
    });

    it("UC-03.1-05 answers 503 when the run started but its stream did not open", async () => {
      signedInAs = ownerId;
      agentService(502);

      const response = await ask("pa", { messages: [{ role: "user", content: "Hello" }] });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "The assistant is unavailable." });
    });
  });

  describe("/api/copilotkit", () => {
    let outbound: string[] = [];
    beforeEach(() => {
      outbound = [];
      globalThis.fetch = (async (url: string | URL | Request) => {
        outbound.push(String(url));
        throw new Error("no outbound call is expected");
      }) as typeof fetch;
    });

    const runtime = async (method: "GET" | "POST", path: string) => {
      const route = await import("@/app/api/copilotkit/[[...slug]]/route");
      return route[method](new Request(`http://console.awp.test/api/copilotkit${path}`, { method }));
    };

    it("4.3.2 registers every live agent for a person who may invoke them, by code", async () => {
      signedInAs = ownerId;
      const live = await testPool().query<{ code: string }>(
        "select code from ai.agent where status in ('Idle', 'Running', 'Waiting') order by code",
      );

      const response = await runtime("GET", "/info");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = (await response.json()) as { agents: Record<string, { name: string }> };
      expect(Object.keys(body.agents).sort()).toEqual(live.rows.map((row) => row.code));
      expect(body.agents.pa).toMatchObject({ name: "pa" });
      // Registering an agent opens no run: nothing was sent to the agent service.
      expect(outbound).toEqual([]);
    });

    it("registers only the placeholder agent for a person who may not invoke agents, or nobody", async () => {
      for (const who of [auditorId, ""]) {
        signedInAs = who;
        const response = await runtime("GET", "/info");
        expect(response.status).toBe(200);
        const body = (await response.json()) as { agents: Record<string, unknown> };
        expect(Object.keys(body.agents)).toEqual(["none"]);
      }
    });

    it("answers 404 for a path the runtime does not serve, and 405 for the wrong method", async () => {
      signedInAs = ownerId;

      const unknown = await runtime("GET", "/not-a-route");
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: "Not found" });

      const wrongMethod = await runtime("POST", "/info");
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("GET");
    });
  });
});
