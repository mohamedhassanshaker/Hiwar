import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The worker lines of `/api/health` (UC-78.1-01): Temporal and the agent service can both answer while no
 * worker polls a task queue, and then every run stays Running. The agent service reports the pollers.
 */
let agentServiceUrl: string | undefined = "http://agent.test";
vi.mock("@/lib/env", () => ({ env: () => ({ AGENT_SERVICE_URL: agentServiceUrl }) }));
vi.mock("@/db/queries/health", () => ({ serverVersion: async () => "17.2" }));
vi.mock("@/lib/valkey", () => ({ liveUpdatesConfigured: () => false, valkey: () => ({ ping: async () => "PONG" }) }));

const { health } = await import("@/lib/health");

/** The agent service answers `/healthz/workers` with `workers`, or fails with `failure`; any other path is up. */
function agentService(workers: unknown, failure?: Error) {
  vi.stubGlobal("fetch", async (url: URL) => {
    if (String(url).endsWith("/healthz/workers")) {
      if (failure) throw failure;
      return new Response(JSON.stringify(workers), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

const workerLines = async () =>
  (await health()).dependencies.filter((probe) => probe.name.endsWith(" worker")).map(({ name, status, detail }) => ({ name, status, detail }));

afterEach(() => {
  vi.unstubAllGlobals();
  agentServiceUrl = "http://agent.test";
});

describe("UC-78.1-01 the System screen says whether work can run", () => {
  it("should_report_a_queue_up_while_a_worker_polls_it_and_down_when_none_does", async () => {
    agentService({ queues: { "agent-runs": { pollers: 1 }, ingestion: { pollers: 0 } } });
    const lines = await workerLines();
    expect(lines.map(({ name, status }) => [name, status])).toEqual([
      ["agent-runs worker", "up"],
      ["ingestion worker", "down"],
      ["maintenance worker", "down"],
    ]);
    expect(lines[1].detail).toMatch(/No worker is polling this queue/);
  });

  it("should_mark_the_platform_degraded_when_a_queue_has_no_worker", async () => {
    agentService({ queues: { "agent-runs": { pollers: 0 }, ingestion: { pollers: 1 }, maintenance: { pollers: 1 } } });
    expect((await health()).status).toBe("degraded");
  });

  it("should_report_every_queue_down_with_the_reason_when_the_agent_service_cannot_say", async () => {
    agentService(null, new Error("connect ECONNREFUSED"));
    const lines = await workerLines();
    expect(lines.every((line) => line.status === "down" && line.detail === "connect ECONNREFUSED")).toBe(true);
  });

  it("should_skip_the_queues_when_no_agent_service_is_configured", async () => {
    agentServiceUrl = undefined;
    agentService({});
    expect((await workerLines()).map((line) => line.status)).toEqual(["skipped", "skipped", "skipped"]);
  });
});
