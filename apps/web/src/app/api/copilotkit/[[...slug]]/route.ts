import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

import { copilotRuntime } from "@/agents/runtime";

/**
 * The single browser-facing agent endpoint (stack specification 4.3).
 *
 * Everything this route decides is in `src/agents/`: which agents the request may use,
 * the token each one runs under, and the middleware over its events. The route only
 * mounts the runtime's multi-route handler under the base path.
 */

// A run streams for as long as it takes; the route must not be cut short.
export const maxDuration = 300;

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
