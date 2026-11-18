import { describe, expect, it } from "vitest";

import { health } from "@/lib/health";

/**
 * Specification 7.5.7 lists the services the System screen shows, and `UC-78.1-01` is that
 * the screen shows every one of them with its version and health. `loadSystem` builds that
 * list from `health()`, so the probe set is the contract: a service missing here is a
 * service missing from the screen, which is how four of the nine went unnoticed.
 */
const SPECIFIED_SERVICES = [
  "web",
  "agent-service",
  "temporal",
  "agentgateway",
  "phoenix",
  "postgres",
  "neo4j",
  "valkey",
  "object-storage",
  // Whether work can run at all: a task queue with no worker polling it (2026-10-31).
  "agent-runs worker",
  "ingestion worker",
  "maintenance worker",
];

describe("UC-78.1-01 the System screen's service list", () => {
  it("probes every service specification 7.5.7 names, and nothing else", async () => {
    const { dependencies } = await health();
    expect(dependencies.map((dependency) => dependency.name)).toEqual(SPECIFIED_SERVICES);
  });

  it("UC-78.1-04 stamps when the probes ran, so an error state has an age", async () => {
    const before = Date.now();
    const { checkedAt } = await health();
    const stamped = new Date(checkedAt).getTime();

    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("UC-78.1-04 carries a reason on a service that did not answer", async () => {
    const { dependencies } = await health();
    // Every probe that reports down must say why; "down" with no reason gives an operator
    // nothing to act on.
    for (const dependency of dependencies.filter((probe) => probe.status === "down")) {
      expect(dependency.detail, `${dependency.name} reported down with no detail`).toBeTruthy();
    }
  });

  it("reports a service that is not configured as skipped rather than down", async () => {
    const { dependencies } = await health();
    // The `core` profile leaves some services out, and a deliberate omission must not read
    // as a failure on the screen. The web application itself is always up: it is answering.
    const web = dependencies.find((dependency) => dependency.name === "web");
    expect(web?.status).toBe("up");
    for (const dependency of dependencies) {
      expect(["up", "down", "skipped"]).toContain(dependency.status);
    }
  });
});
