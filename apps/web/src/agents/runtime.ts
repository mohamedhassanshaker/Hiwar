import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime } from "@copilotkit/runtime/v2";

import { selectFeatureFlag } from "@/db/queries/agents";
import { getSession } from "@/lib/session";
import { governedMiddleware } from "./middleware";
import { resolveAgentsForRequest, scopeFromRequest } from "./registry";

/**
 * The CopilotKit runtime the browser talks to (stack specification 4.3.2).
 *
 * One `HttpAgent` per AWP agent the request may use, pointed at this application's own
 * AG-UI route and wrapped in the governed middleware. The browser never holds a token and
 * never reaches the agent service.
 *
 * The route is ours, not the agent service's: a run is assembled from the agent's version,
 * instructions, route and budget and from the permissions of the person asking, all of
 * which are this application's data. `/api/agui/[agentCode]` does that and then streams the
 * run's AG-UI events back. The agent service is handed a finished run and a token.
 */

/**
 * This application's AG-UI route for one agent, on the server's own listener.
 *
 * The runtime runs inside this server, so the call is a loopback one. Naming the public
 * origin would send it back out through the gateway, and a container cannot reach the host
 * name the browser uses: the run would fail with "fetch failed" and the conversation would
 * sit waiting for an answer that never came.
 */
function aguiUrl(agentKey: string): string {
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}/api/agui/${encodeURIComponent(agentKey)}`;
}

/** The "Capture full traces (RAW events)" flag of specification 7.5.5. */
const CAPTURE_RAW_EVENTS = "capture-full-traces-raw-events";

/**
 * The agent a request with no permitted agent gets. The runtime refuses an empty record,
 * and this one answers nothing: the refusal then comes from the agent service as a 4xx
 * rather than from the runtime as a 500.
 */
function noAgent(): HttpAgent {
  return new HttpAgent({ url: aguiUrl("none") });
}

/**
 * The headers a loopback call carries.
 *
 * The AG-UI route decides the run under the asking person's session, and a call this server
 * makes to itself starts with none, so the request's own cookie goes with it.
 */
function sessionHeaders(request: Request): Record<string, string> {
  const cookie = request.headers.get("cookie");
  return cookie ? { cookie } : {};
}

export const copilotRuntime = new CopilotRuntime({
  // Per request, because which agents exist depends on who is asking and what they asked
  // for: every agent they may invoke, one room's lead and member agents, or one embedded
  // deployment's agent.
  agents: async ({ request }) => {
    const [session, registered, captureRawEvents] = await Promise.all([
      getSession(),
      resolveAgentsForRequest(scopeFromRequest(request)),
      selectFeatureFlag(CAPTURE_RAW_EVENTS),
    ]);

    const agents: Record<string, HttpAgent> = {};
    for (const agent of registered) {
      // The agent's code, not its row id: the route resolves the version and mints the run
      // token itself, under the session it already has.
      const http = new HttpAgent({ url: aguiUrl(agent.key), headers: sessionHeaders(request) });
      http.use(
        governedMiddleware({
          agentId: agent.id,
          agentLabel: agent.nameEn,
          personId: session?.personId ?? "",
          captureRawEvents,
        }),
      );
      agents[agent.key] = http;
    }

    if (Object.keys(agents).length === 0) agents.none = noAgent();
    return agents as Record<string, HttpAgent> & { [key: string]: HttpAgent };
  },
});
