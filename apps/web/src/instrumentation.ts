import type { Instrumentation } from "next";

/**
 * Node-only start-up work lives in `instrumentation-node.ts`. The import sits inside the
 * `NEXT_RUNTIME` check so the Edge bundle does not trace its Node.js modules.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNodeWork } = await import("./instrumentation-node");
    startNodeWork();
  }
}

/** Errors a route boundary shows as a banner are logged here in full, one JSON line each. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { logServerError } = await import("@/lib/logger");
  logServerError(request.path, error, { method: request.method, router: context.routerKind, route: context.routePath, type: context.routeType });
};
