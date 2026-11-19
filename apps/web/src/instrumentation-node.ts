import { renderingConfigured } from "@/lib/kubernetes";
import { logger } from "@/lib/logger";
import { republishRoutes } from "@/features/models/service";
import { sweep } from "./server/visitor";
import { billingSweep } from "./server/billing";
import { pushHealthAlerts } from "./server/ops";

/**
 * Start-up work in the Node.js server:
 * - The AI module's agentgateway routes are republished from Models & routes, because the
 *   gateway is a projection of that record and a fresh cluster or seed leaves it empty. Only
 *   where the Kubernetes client is configured (the kind and cloud deployments).
 * - Periodic work every 30 seconds: auto-close, the no-person behaviour after the claim wait,
 *   and the trial and plan schedule. One timer per process.
 */
export function startNodeWork(): void {
  const state = globalThis as unknown as { hiwarSweep?: ReturnType<typeof setInterval> };
  if (state.hiwarSweep) return;
  void republishGatewayRoutes();
  let running = false;
  let ticks = 0;
  state.hiwarSweep = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweep();
      await billingSweep();
      // The health queries are heavier, so alerts are checked every 10 minutes.
      if (ticks++ % 20 === 0) await pushHealthAlerts();
    } catch (problem) {
      console.error("sweep failed", problem);
    } finally {
      running = false;
    }
  }, 30_000);
}

async function republishGatewayRoutes(): Promise<void> {
  if (!renderingConfigured()) return;
  try {
    const { published, failed } = await republishRoutes();
    logger().info({ published: published.length, failed }, "agentgateway routes reconciled");
  } catch (error) {
    logger().error({ err: error }, "agentgateway routes could not be reconciled at start-up");
  }
}
