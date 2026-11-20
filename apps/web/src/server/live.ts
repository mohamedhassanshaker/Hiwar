import { EventEmitter } from "node:events";

import { Client } from "pg";

import { pool } from "@/db";
import { env } from "./env";

/**
 * Live updates. Writers call `publish(topic, event)`, which issues NOTIFY on one channel;
 * every web process LISTENs once and fans the event out to its SSE subscribers by topic.
 * Topics: `org:<id>` (inbox lists, notifications) and `conv:<id>` (one thread, the widget).
 */

const CHANNEL = "hiwar_live";
const state = globalThis as unknown as { hiwarLive?: { bus: EventEmitter; started: Promise<void> | null } };
state.hiwarLive ??= { bus: new EventEmitter().setMaxListeners(0), started: null };
const live = state.hiwarLive;

function start(): Promise<void> {
  live.started ??= (async () => {
    // LISTEN holds one session open, so it bypasses the pooler, whose transaction mode never
    // delivers notifications; without a pooler (development) DATABASE_URL is already direct.
    const client = new Client({ connectionString: env().DATABASE_LISTEN_URL ?? env().DATABASE_URL });
    client.on("notification", (message) => {
      if (!message.payload) return;
      const { topic, event } = JSON.parse(message.payload) as { topic: string; event: unknown };
      live.bus.emit(topic, event);
    });
    client.on("error", () => {
      // The connection dropped: the next subscriber reconnects.
      live.started = null;
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  })();
  return live.started;
}

export async function publish(topic: string, event: Record<string, unknown>): Promise<void> {
  await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ topic, event })]);
}

/** Subscribes to topics; returns the function that unsubscribes. */
export async function subscribe(topics: string[], listener: (event: unknown) => void): Promise<() => void> {
  await start();
  for (const topic of topics) live.bus.on(topic, listener);
  return () => {
    for (const topic of topics) live.bus.off(topic, listener);
  };
}

/** A text/event-stream response that forwards events on `topics` until the client goes away. */
export function sseResponse(request: Request, topics: string[]): Response {
  const encoder = new TextEncoder();
  let stop: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    stop?.();
    if (heartbeat) clearInterval(heartbeat);
  };
  const stream = new ReadableStream({
    async start(controller) {
      // Nothing is written after the client has gone: a write to a closed stream throws.
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          finish();
        }
      };
      stop = await subscribe(topics, (event) => write(`data: ${JSON.stringify(event)}\n\n`));
      write(": connected\n\n");
      heartbeat = setInterval(() => write(": ping\n\n"), 20_000);
      request.signal.addEventListener("abort", () => {
        finish();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      });
    },
    cancel() {
      finish();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
