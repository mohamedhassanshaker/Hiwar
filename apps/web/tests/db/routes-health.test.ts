import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeTestPool, hasDatabase } from "./harness";

/**
 * `GET /api/health` (acceptance 19). The Kubernetes readiness probe and the System screen both
 * read it, so it always answers 200 with one line per dependency, never cached, and a
 * dependency that is down shows in the body rather than in the status code.
 *
 * `tests/health.test.ts` covers the probe list; these cover the route. The HTTP probes are
 * answered here instead of by the services; PostgreSQL is the real one.
 */

process.env.AGENT_SERVICE_URL = "http://agent-service.test";
// Only the agent service is probed over HTTP in these cases.
delete process.env.AGW_LLM_URL;
delete process.env.PHOENIX_BASE_URL;
delete process.env.S3_ENDPOINT;
delete process.env.TEMPORAL_ADDRESS;
delete process.env.NEO4J_URI;
delete process.env.VALKEY_URL;

describe.skipIf(!hasDatabase)("GET /api/health", () => {
  const realFetch = globalThis.fetch;
  let probed: string[] = [];

  /** The agent service answers its health path with `status`. */
  const agentServiceAnswers = (status: number) => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      probed.push(String(url));
      return new Response(null, { status });
    }) as typeof fetch;
  };

  afterEach(() => {
    globalThis.fetch = realFetch;
    probed = [];
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("answers 200, uncached, with every dependency up when they all answer", async () => {
    const { GET } = await import("@/app/api/health/route");
    agentServiceAnswers(200);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { status: string; checkedAt: string; dependencies: { name: string; status: string }[] };
    expect(body.status).toBe("ok");
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    const byName = Object.fromEntries(body.dependencies.map((one) => [one.name, one.status]));
    expect(byName).toMatchObject({ web: "up", "agent-service": "up", postgres: "up", temporal: "skipped", valkey: "skipped" });
    expect(probed).toEqual(["http://agent-service.test/healthz"]);
  });

  it("still answers 200 when a dependency is down, and says which and why in the body", async () => {
    const { GET } = await import("@/app/api/health/route");
    agentServiceAnswers(503);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { status: string; dependencies: { name: string; status: string; detail?: string }[] };
    expect(body.status).toBe("degraded");
    expect(body.dependencies.find((one) => one.name === "agent-service")).toMatchObject({ status: "down", detail: "HTTP 503" });
  });
});
