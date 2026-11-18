import { liveUpdatesConfigured, runEventReader } from "@/lib/valkey";
import * as repository from "./repository";
import { sessionView, type SessionClaims } from "./widget-session";

/**
 * The widget's server-sent events (widget specification 14, D231).
 *
 * `message.start` / `message.delta` carry an agent's reply as it is written, read from the
 * run's own event stream; `message.end` carries each finished message in full; `typing` says
 * the agent is working; `handoff.update` says where a handover stands; `session.update`
 * carries the state and a fresh session token whenever the conversation moves.
 *
 * Change is noticed by a cheap mark (the last line, the state's write time and whether a run
 * is live) rather than by rebuilding the view every second.
 */

const HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

const TICK_MS = 1000;
const KEEPALIVE_MS = 20_000;

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * The server-sent event response for one widget session, open until the request is aborted.
 * The messages the session already shows are not sent again.
 */
export function widgetStream(claims: SessionClaims, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    /**
     * Each tick relays the live run's text events from the last offset read (waiting up to a
     * tick for them), or sleeps a tick when no run is live; then, when the conversation's mark
     * changed, sends the new messages and the changed state, or a keepalive after 20 s of
     * quiet. A failure sends `error` and closes.
     */
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      let mark = await repository.conversationMark(claims.conversationId);
      const sent = new Set((await sessionView(claims)).messages.map((message) => message.id));
      let handoff: string | null = null;
      let typing = false;
      let streamingRun: string | null = null;
      let offset = "0-0";
      let quietSince = Date.now();
      const reader = liveUpdatesConfigured() ? runEventReader() : null;
      try {
        while (!signal.aborted) {
          const runId = reader ? await repository.activeRunOf(claims.conversationId) : null;
          if (runId && reader) {
            if (runId !== streamingRun) {
              streamingRun = runId;
              offset = "0-0";
            }
            const events = await reader.read(runId, offset, TICK_MS);
            for (const one of events) {
              offset = one.offset;
              const parsed = JSON.parse(one.payload) as { type?: string; delta?: string; messageId?: string };
              if (parsed.type === "TEXT_MESSAGE_START") send(event("message.start", { id: `run_${runId}`, role: "assistant" }));
              if (parsed.type === "TEXT_MESSAGE_CONTENT" && parsed.delta) {
                send(event("message.delta", { id: `run_${runId}`, blockIndex: 0, text: parsed.delta }));
              }
            }
          } else {
            streamingRun = null;
            await new Promise((resolve) => setTimeout(resolve, TICK_MS));
          }
          if (signal.aborted) break;

          const now = await repository.conversationMark(claims.conversationId);
          if (now !== mark) {
            mark = now;
            const view = await sessionView(claims);
            for (const message of view.messages) {
              if (!sent.has(message.id)) {
                sent.add(message.id);
                send(event("message.end", message));
              }
            }
            if (view.state.pending !== typing) {
              typing = view.state.pending;
              send(event("typing", { on: typing }));
            }
            if (view.state.handoff !== handoff) {
              handoff = view.state.handoff;
              send(event("handoff.update", { state: handoff }));
            }
            send(event("session.update", view));
            quietSince = Date.now();
          } else if (Date.now() - quietSince > KEEPALIVE_MS) {
            send(": keepalive\n\n");
            quietSince = Date.now();
          }
        }
      } catch {
        if (!signal.aborted) send(event("error", { code: "TOOL_UNAVAILABLE", message: "Connection lost. Retrying…" }));
      } finally {
        reader?.close();
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      }
    },
  });
  return new Response(body, { headers: HEADERS });
}
