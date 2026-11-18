import { liveUpdatesConfigured, runEventReader, subscribe } from "./valkey";

/**
 * Server-sent events, the console's live path (stack specification 4.2).
 *
 * Two shapes, because the sources differ. A channel is pub/sub — a room message, an inbox
 * badge, a dashboard card — where a late subscriber has missed nothing it needs. A run's
 * AG-UI events are a stream with offsets, so a browser that reconnects replays from the
 * last event it saw rather than from the start or not at all (§4.3.4).
 */

const HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Traefik streams this path unbuffered (§8.6); the header says so to anything else in between.
  "x-accel-buffering": "no",
};

/** How often a quiet stream sends a comment, so an idle connection is not reaped. */
const KEEPALIVE_MS = 20_000;

function frame(payload: string, id?: string): string {
  return `${id ? `id: ${id}\n` : ""}data: ${payload}\n\n`;
}

/**
 * An installation with no Valkey has no live path at all.
 *
 * It answers 501 rather than opening a stream that will never carry anything: the browser
 * closes a stream that answered an error and stops asking, where one that is opened and
 * then fails is reconnected to for ever. Every screen in the console attaches to one of
 * these, so a stream that cannot work has to say so once.
 */
const unavailable = () =>
  new Response("Live updates are not configured.", { status: 501, headers: { "cache-control": "no-store" } });

/** A response that forwards one Valkey channel until the client goes away. */
export function channelStream(channel: string, signal: AbortSignal): Response {
  if (!liveUpdatesConfigured()) return unavailable();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    /** Sends a keepalive comment every `KEEPALIVE_MS` and each channel message as a frame until aborted. */
    start(controller) {
      const keepalive = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), KEEPALIVE_MS);
      const close = () => {
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away; nothing to do.
        }
      };
      signal.addEventListener("abort", close);
      subscribe(channel, (payload) => controller.enqueue(encoder.encode(frame(payload))), signal);
    },
  });
  return new Response(body, { headers: HEADERS });
}

/**
 * A response that replays one run's AG-UI events from an offset and then follows it.
 * The browser sends the offset back as `Last-Event-ID`, which is what makes a reconnect
 * continue rather than restart.
 */
export function runStream(runId: string, after: string, signal: AbortSignal): Response {
  if (!liveUpdatesConfigured()) return unavailable();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    /**
     * Reads the run's events after `offset` in a loop until aborted, sending each with its offset
     * as the event id, and a keepalive comment when a read times out with nothing new.
     */
    async start(controller) {
      let offset = after;
      const reader = runEventReader();
      try {
        while (!signal.aborted) {
          const events = await reader.read(runId, offset, KEEPALIVE_MS);
          if (events.length === 0) {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
            continue;
          }
          for (const event of events) {
            offset = event.offset;
            controller.enqueue(encoder.encode(frame(event.payload, event.offset)));
          }
        }
      } finally {
        reader.close();
        try {
          controller.close();
        } catch {
          // Already closed by the client going away; nothing to do.
        }
      }
    },
  });
  return new Response(body, { headers: HEADERS });
}
