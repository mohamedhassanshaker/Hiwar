import type { Instrumentation } from "next";

/**
 * Reconcile the agentgateway projection when the server starts.
 *
 * Models & routes is the record; the gateway is a projection of it (stack specification
 * 6.1). A projection must be rebuildable, because what holds it is not durable: a cluster
 * recreated from scratch, or a database seeded into an empty install, leaves the gateway
 * holding nothing while every screen shows routes that no agent can call. The seed cannot
 * do it — it runs on a developer's machine, through a port-forward, with no service account
 * to apply with — so the place that always has one is this process.
 *
 * Publishing is idempotent, server-side applied, so running it on every start is safe. It
 * never blocks start-up: a gateway that is not ready yet is a reason to log and carry on,
 * not a reason to refuse to serve the console.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime has the Kubernetes client and the database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // D240: the background consumer of the system email notifications, one per server.
  const { startMailConsumer } = await import("@/features/governance/notification-service");
  startMailConsumer();

  const { renderingConfigured } = await import("@/lib/kubernetes");
  if (!renderingConfigured()) return;

  const { logger } = await import("@/lib/logger");
  try {
    const { republishRoutes } = await import("@/features/models/service");
    const { published, failed } = await republishRoutes();
    logger().info({ published: published.length, failed }, "agentgateway routes reconciled");
  } catch (error) {
    logger().error({ err: error }, "agentgateway routes could not be reconciled at start-up");
  }
}

/**
 * `nextjs-rules.md` rule 12: the server counterpart of the route-level error boundaries.
 * Whatever a boundary shows the person as a non-technical banner is written here in full,
 * as one structured JSON line, with the request that produced it.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { logServerError } = await import("@/lib/logger");
  logServerError(request.path, error, {
    method: request.method,
    router: context.routerKind,
    route: context.routePath,
    type: context.routeType,
  });
};
