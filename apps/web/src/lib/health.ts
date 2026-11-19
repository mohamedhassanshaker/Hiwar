import { serverVersion } from "@/db/queries/health";
import { env } from "./env";
import { liveUpdatesConfigured, valkey } from "./valkey";

/**
 * Requirement 60 and acceptance 19: `GET /api/health` answers with one line per dependency.
 * Each probe is cheap and bounded; a dependency that is not configured reports `skipped`
 * rather than `down`, because the `core` profile deliberately leaves some of them out.
 */
export type Probe = {
  name: string;
  status: "up" | "down" | "skipped";
  version: string | null;
  detail?: string;
};

const TIMEOUT_MS = 2_000;

/** `work`, or a rejection after `TIMEOUT_MS`, whichever comes first. The work itself is not cancelled. */
async function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`timed out after ${TIMEOUT_MS} ms`)),
        TIMEOUT_MS,
      ),
    ),
  ]);
}

/** GETs `path` on an HTTP dependency: skipped when it has no URL, down on a 5xx, a timeout or no answer. */
async function probe(
  name: string,
  url: string | undefined,
  path: string,
): Promise<Probe> {
  if (!url) return { name, status: "skipped", version: null };
  try {
    const response = await withTimeout(
      fetch(new URL(path, url), { cache: "no-store" }),
    );
    // Anything below 500 means the dependency answered: a gateway that replies 404 on a
    // path it does not serve is up, and only a server error or no answer at all is down.
    const up = response.status < 500;
    return {
      name,
      status: up ? "up" : "down",
      version: null,
      detail: up ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      status: "down",
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** PostgreSQL is up when it reports its server version within the timeout. */
async function probePostgres(): Promise<Probe> {
  try {
    return {
      name: "postgres",
      status: "up",
      version: await withTimeout(serverVersion()),
    };
  } catch (error) {
    return {
      name: "postgres",
      status: "down",
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Temporal and Neo4j speak gRPC and Bolt, not HTTP, so neither answers `fetch`. Both do
 * accept a TCP connection, which is what "the service is reachable" means for the System
 * screen; the workflow and graph calls themselves report their own errors.
 */
async function probeSocket(
  name: string,
  url: string | undefined,
): Promise<Probe> {
  if (!url) return { name, status: "skipped", version: null };
  try {
    const { hostname, port } = new URL(
      url.includes("://") ? url : `tcp://${url}`,
    );
    const { Socket } = await import("node:net");
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
        socket.connect(Number(port), hostname);
      }),
    );
    return { name, status: "up", version: null };
  } catch (error) {
    return {
      name,
      status: "down",
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Valkey answers PING, which proves the protocol and not only the socket. */
async function probeValkey(): Promise<Probe> {
  if (!liveUpdatesConfigured())
    return { name: "valkey", status: "skipped", version: null };
  try {
    await withTimeout(valkey().ping());
    return { name: "valkey", status: "up", version: null };
  } catch (error) {
    return {
      name: "valkey",
      status: "down",
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The Temporal task queues the agent workers serve; each needs a worker polling it. */
export const WORKER_QUEUES = [
  "agent-runs",
  "ingestion",
  "maintenance",
] as const;

/**
 * One line per task queue: up while a worker polls it, down when none does. Temporal and the agent
 * service can both answer while no worker serves a queue, and then every run stays Running (2026-10-31),
 * so the sockets alone do not say that work can run. The agent service asks Temporal (`/healthz/workers`).
 */
async function probeWorkers(url: string | undefined): Promise<Probe[]> {
  const named = (queue: string) => `${queue} worker`;
  if (!url)
    return WORKER_QUEUES.map((queue) => ({
      name: named(queue),
      status: "skipped",
      version: null,
    }));
  try {
    const response = await withTimeout(
      fetch(new URL("/healthz/workers", url), { cache: "no-store" }),
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      queues?: Record<string, { pollers?: number }>;
    };
    return WORKER_QUEUES.map((queue): Probe =>
      (body.queues?.[queue]?.pollers ?? 0) > 0
        ? { name: named(queue), status: "up", version: null }
        : {
            name: named(queue),
            status: "down",
            version: null,
            detail:
              "No worker is polling this queue, so its work never starts.",
          },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return WORKER_QUEUES.map((queue) => ({
      name: named(queue),
      status: "down",
      version: null,
      detail,
    }));
  }
}

/**
 * Every service specification 7.5.7 lists on the System screen (`UC-78.1-01`), with the web
 * application itself first — it is the process answering, so it is up by construction, and
 * omitting it would leave the screen one service short of the nine the specification names. The
 * three worker lines after them say whether runs, ingestion and schedules can actually execute.
 */
export async function health(): Promise<{
  status: "ok" | "degraded";
  checkedAt: string;
  dependencies: Probe[];
}> {
  const configured = env();
  const [services, workers] = await Promise.all([
    Promise.all([
      Promise.resolve<Probe>({
        name: "web",
        status: "up",
        version: process.env.npm_package_version ?? null,
      }),
      probe("agent-service", configured.AI_AGENT_SERVICE_URL, "/healthz"),
      probeSocket("temporal", configured.TEMPORAL_ADDRESS),
      // The OpenAI-compatible model list, which is the only thing this listener serves.
      probe("agentgateway", configured.AGW_LLM_URL, "/v1/models"),
      probe("phoenix", configured.PHOENIX_BASE_URL, "/healthz"),
      probePostgres(),
      probeSocket("neo4j", configured.NEO4J_URI),
      probeValkey(),
      // The S3 root, not a vendor health path: Test and Live run Rook Ceph RGW and a laptop
      // runs the development object store, and both answer `/` with a status below 500.
      probe("object-storage", configured.S3_ENDPOINT, "/"),
    ]),
    probeWorkers(configured.AI_AGENT_SERVICE_URL),
  ]);
  const dependencies = [...services, ...workers];
  // `UC-78.1-04`: the System screen shows an unhealthy service with the time of the check,
  // because "down" without a timestamp could be from a minute ago or from a stale page.
  return {
    status: dependencies.some((dependency) => dependency.status === "down")
      ? "degraded"
      : "ok",
    checkedAt: new Date().toISOString(),
    dependencies,
  };
}
