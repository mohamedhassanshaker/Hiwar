import { ConnectorRejected, finishOAuthConnect } from "@/features/connectors/service";
import { connectorOfState } from "@/features/connectors/credential-auth";
import { env } from "@/lib/env";
import { NotPermitted } from "@/lib/session";

/**
 * D296: where an authorization server sends an administrator back after they connect an OAuth
 * connector. The code is exchanged for tokens only for the person who started the Connect, and
 * the Connectors screen opens on the connector with what happened.
 */

// Never cached and never prerendered: what this answers depends on who is asking.
export const instant = false;

/**
 * Finishes the OAuth Connect named by `state` with the returned `code`, then redirects (303) to
 * `/connectors` with `connect=connected` or `connect=failed` and the reason, cut at 300 characters.
 */
export async function GET(request: Request): Promise<Response> {
  const asked = new URL(request.url).searchParams;
  const state = asked.get("state") ?? "";
  const code = asked.get("code");
  const back = (outcome: "connected" | "failed", reason?: string) => {
    const target = new URL("/connectors", env().APP_URL);
    if (state) target.searchParams.set("open", connectorOfState(state));
    target.searchParams.set("connect", outcome);
    if (reason) target.searchParams.set("reason", reason.slice(0, 300));
    return Response.redirect(target, 303);
  };

  // The authorization server's own refusal, such as the person declining.
  const refused = asked.get("error");
  if (refused) return back("failed", asked.get("error_description") ?? refused);
  if (!state || !code) return back("failed", "The authorization server sent no code.");

  try {
    await finishOAuthConnect(state, code);
    return back("connected");
  } catch (problem) {
    if (problem instanceof ConnectorRejected) return back("failed", problem.message);
    if (problem instanceof NotPermitted) return back("failed", "You may not change connectors.");
    throw problem;
  }
}
