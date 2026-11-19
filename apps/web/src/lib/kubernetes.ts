import { existsSync } from "node:fs";

import {
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
  type KubernetesObject,
} from "@kubernetes/client-node";

import { env } from "./env";
import { logger } from "./logger";

/**
 * The Kubernetes client (stack specification 4.1 and 6.1).
 *
 * The console renders two things into the cluster and nothing else: agentgateway's LLM,
 * MCP and A2A routes from Models & routes, Connectors and Integrations, and the stdio
 * connector pods of §6.4. It does so through a service account whose Role covers exactly
 * those resources in `awp-ai` and `awp-sandbox` — the chart grants no more.
 *
 * In-cluster configuration only. On a developer's machine there is no service account
 * token, so `renderingConfigured()` is false and the screens save to the database without
 * applying anything; `make deploy` is what puts the rendered resources in the cluster.
 */

let api: KubernetesObjectApi | null = null;
let unavailable = false;

/** Where the kubelet mounts the pod's service account token. */
const TOKEN_FILE = "/var/run/secrets/kubernetes.io/serviceaccount/token";

/** The Kubernetes object API from the in-cluster configuration, built once per process. */
function client(): KubernetesObjectApi {
  if (api) return api;
  const config = new KubeConfig();
  config.loadFromCluster();
  api = KubernetesObjectApi.makeApiClient(config);
  return api;
}

/**
 * Whether this process can apply anything at all.
 *
 * The token file and the API server's address are both checked, because
 * `loadFromCluster()` does not fail without them: it builds a configuration whose host is
 * `undefined` and the failure only surfaces on the first request, as a saved route that
 * reports itself unapplied on a machine that was never going to apply it.
 */
export function renderingConfigured(): boolean {
  if (unavailable) return false;
  const reason = !process.env.KUBERNETES_SERVICE_HOST
    ? "KUBERNETES_SERVICE_HOST is not set"
    : !existsSync(TOKEN_FILE)
      ? "there is no service account token"
      : null;
  if (reason) {
    unavailable = true;
    logger().info({ reason }, "no in-cluster configuration: agentgateway routes are saved but not applied");
    return false;
  }
  try {
    client();
    return true;
  } catch (problem) {
    unavailable = true;
    logger().info(
      { reason: (problem as Error).message },
      "no in-cluster configuration: agentgateway routes are saved but not applied",
    );
    return false;
  }
}

/** The namespace the AI resources live in (stack specification 8.3). */
export function aiNamespace(): string {
  return env().AI_NAMESPACE;
}

/**
 * Create or replace one resource. Server-side apply, so the console owns the fields it
 * sets and leaves anything another controller added alone, and so re-applying an
 * unchanged resource changes nothing.
 */
export async function apply(resource: KubernetesObject): Promise<void> {
  await client().patch(
    resource,
    undefined,
    undefined,
    "awp-console",
    true,
    PatchStrategy.ServerSideApply,
  );
}

/** Remove a resource the console previously rendered. A missing one is already gone. */
export async function remove(resource: KubernetesObject): Promise<void> {
  try {
    await client().delete(resource);
  } catch (problem) {
    const status = (problem as { code?: number }).code;
    if (status === 404) return;
    logger().warn(
      { kind: resource.kind, name: resource.metadata?.name, problem },
      "a rendered resource was not removed",
    );
    throw problem;
  }
}
