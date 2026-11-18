import { clientStreamEvents, startClientRun } from "@/features/integrations/service";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/logger";

/**
 * The AG-UI stream an integration client reaches (S-77).
 *
 * The client's own key is the credential, and what the admin configured is what bounds it:
 * the exposure has to be on, the origin has to be allowed, and the agent has to be one the
 * client was given. Events the client was not given are dropped from the stream rather than
 * filtered by the caller.
 */

export const instant = false;
export const maxDuration = 300;

const REFUSAL_STATUS: Record<string, number> = {
  NoCredential: 401,
  OriginNotAllowed: 403,
  AguiOff: 403,
  AgentNotAllowed: 403,
  NotPermitted: 403,
  // `UC-03.1-05`: the agent or the agent service is unavailable; the client may try again.
  RunNotStarted: 503,
};

function key(request: Request): string {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

/** `UC-77.3-03`: a preflight from an origin that is not allowed gets no allowance back. */
export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: {
      ...(origin ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      vary: "Origin",
    },
  });
}

/**
 * Starts a run for an integration client, authenticated by its bearer key, and relays the run's
 * AG-UI stream, filtered to the client's events when it was given a list. 400 without an agent
 * and a prompt; a refusal from `startClientRun` answers with its `REFUSAL_STATUS` (403 when
 * unlisted); 503 when the stream does not open.
 */
export async function POST(request: Request, context: { params: Promise<{ clientCode: string }> }): Promise<Response> {
  const { clientCode } = await context.params;
  const origin = request.headers.get("origin");
  const body = (await request.json().catch(() => ({}))) as { agent?: string; prompt?: string };
  if (!body.agent || !body.prompt?.trim()) {
    return Response.json({ reason: "A call needs an agent and a prompt." }, { status: 400 });
  }

  const started = await startClientRun({ secret: key(request), origin, agentCode: body.agent, prompt: body.prompt });
  if ("refusal" in started) {
    if (started.refusal === "RunNotStarted") logServerError("/api/integrations/agui", new Error(started.detail), { clientCode });
    return Response.json({ reason: started.detail, refusal: started.refusal }, { status: REFUSAL_STATUS[started.refusal] ?? 403, headers: { vary: "Origin" } });
  }

  const upstream = await fetch(`${env().AGENT_SERVICE_URL}/agui/runs/${started.runId}/stream`, {
    headers: { accept: "text/event-stream" },
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    logServerError("/api/integrations/agui", new Error("the run started but its stream did not open"), { clientCode });
    return Response.json({ reason: "The assistant is unavailable." }, { status: 503 });
  }

  const allowed = await clientStreamEvents(key(request));
  return new Response(allowed.length > 0 ? filtered(upstream.body, allowed) : upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-awp-run-id": started.runId,
      "x-accel-buffering": "no",
      ...(origin ? { "access-control-allow-origin": origin } : {}),
      vary: "Origin",
    },
  });
}

/**
 * Keeps only the AG-UI events the client was given.
 *
 * Server-sent events are separated by a blank line, so a block is forwarded whole or not at
 * all; an event the client may not see never reaches it.
 */
function filtered(body: ReadableStream<Uint8Array>, allowed: string[]): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      /** Forwards each complete event block whose type is allowed and keeps the rest buffered. */
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary + 2);
          buffer = buffer.slice(boundary + 2);
          // Matches both a JSON `type` field and an SSE `event:` line.
          if (allowed.some((event) => block.includes(`"type":"${event}"`) || block.includes(`event: ${event}`))) {
            controller.enqueue(encoder.encode(block));
          }
          boundary = buffer.indexOf("\n\n");
        }
      },
      flush(controller) {
        if (buffer !== "") controller.enqueue(encoder.encode(buffer));
      },
    }),
  );
}
