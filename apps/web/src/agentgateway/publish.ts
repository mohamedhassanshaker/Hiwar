import { logger } from "@/lib/logger";
import { apply, renderingConfigured } from "@/lib/kubernetes";
import { renderRoute, type RenderableRoute } from "./render";

/**
 * Putting a route from Models & routes into the gateway (stack specification 6.1).
 *
 * "The web app renders agentgateway resources from Models & routes, Connectors and
 * Integrations… It applies them through a narrow-scoped Kubernetes service account.
 * Changes take effect without restarting the agent service."
 *
 * The database is the record: a route is saved there first and published here second. A
 * publish that fails does not undo the save — the route is still what the screen shows and
 * what the next publish will apply — but it is logged, and the screen is told, because a
 * route the gateway has not got is a route no agent can call.
 */

export class RoutePublishFailed extends Error {
  constructor(
    readonly alias: string,
    cause: unknown,
  ) {
    super(`the route ${alias} was saved but not applied to the gateway`);
    this.name = "RoutePublishFailed";
    this.cause = cause;
  }
}

/**
 * Apply one route's resources. Does nothing outside the cluster, where there is no service
 * account: `make deploy` is what renders the routes there.
 */
export async function publishRoute(route: RenderableRoute): Promise<void> {
  if (!renderingConfigured()) return;
  try {
    for (const resource of renderRoute(route)) {
      await apply(resource);
    }
    logger().info({ alias: route.alias, steps: route.steps.length }, "route applied to the gateway");
  } catch (problem) {
    logger().error({ alias: route.alias, problem }, "route was not applied to the gateway");
    throw new RoutePublishFailed(route.alias, problem);
  }
}
