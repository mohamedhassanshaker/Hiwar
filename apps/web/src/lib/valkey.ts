import Valkey from "iovalkey";

import { env } from "./env";
import { logger } from "./logger";

/**
 * Valkey, for the live parts of the console (stack specification 4.2 and 7.2): room
 * fan-out, the inbox badge, the live dashboard cards, and the AG-UI stream a run writes.
 *
 * Two connections, because a subscriber cannot run ordinary commands: one for publishing
 * and reading, one per subscription. Both are lazy — nothing connects until something
 * actually needs the server, so a `core` profile without live updates costs nothing.
 */

/** The channels of specification 7.2, so no caller spells one by hand. */
export const channels = {
  room: (roomId: string) => `room:${roomId}`,
  inbox: (personId: string) => `inbox:${personId}`,
  dashboard: (scope: string) => `dash:${scope}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  /** Every visitor conversation's activity, for the open-conversations panel and desktop alerts (D344). */
  conversations: () => "conversations",
  /** The AG-UI stream the harness writes, read back by offset on a reconnect. */
  runEvents: (runId: string) => `run:${runId}:agui`,
};

let client: Valkey | null = null;

/** A new lazily connecting Valkey connection that logs its errors. Throws without `VALKEY_URL`. */
function connect(): Valkey {
  const url = env().VALKEY_URL;
  if (!url) throw new Error("VALKEY_URL is not set; live updates are unavailable");
  const connection = new Valkey(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  connection.on("error", (problem: Error) => {
    logger().warn({ problem: problem.message }, "valkey connection error");
  });
  return connection;
}

/** The shared connection for publishing and reading. */
export function valkey(): Valkey {
  if (!client) client = connect();
  return client;
}

/** Whether Valkey is configured at all; the `core` profile may leave it out. */
export function liveUpdatesConfigured(): boolean {
  return Boolean(env().VALKEY_URL);
}

/** Publish one message to a channel. Never throws: a dropped update is not a failed write. */
export async function publish(channel: string, payload: unknown): Promise<void> {
  try {
    await valkey().publish(channel, JSON.stringify(payload));
  } catch (problem) {
    logger().warn({ channel, problem }, "live update was not published");
  }
}

/**
 * Subscribe to a channel until the signal aborts. Each subscription owns its connection,
 * because a subscribed client may not issue other commands.
 */
export function subscribe(
  channel: string,
  onMessage: (payload: string) => void,
  signal: AbortSignal,
): void {
  const connection = connect();
  void connection.subscribe(channel).catch((problem: unknown) => {
    logger().warn({ channel, problem }, "live subscription failed");
  });
  connection.on("message", (_channel: string, payload: string) => onMessage(payload));
  signal.addEventListener("abort", () => {
    void connection.quit().catch(() => connection.disconnect());
  });
}

/**
 * A reader of runs' AG-UI streams on a connection of its own, for one follower: a blocking read
 * holds the connection it runs on, and on the shared one every publish waited behind it (D350).
 * `close` disconnects it, so a follower that goes away does not hold a connection.
 */
export function runEventReader() {
  const connection = connect();
  return {
    /**
     * The events a run has produced since an offset, waiting up to `blockMs` for one. The
     * harness writes them to a stream, so a browser that attaches late or reconnects replays
     * from where it stopped rather than losing what it missed (stack specification 4.3.4).
     */
    async read(runId: string, after: string, blockMs: number): Promise<Array<{ offset: string; payload: string }>> {
      const response = (await connection.xread(
        "COUNT",
        200,
        "BLOCK",
        blockMs,
        "STREAMS",
        channels.runEvents(runId),
        after,
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!response) return [];
      return response.flatMap(([, entries]) =>
        entries.map(([offset, fields]) => {
          const index = fields.indexOf("event");
          return { offset, payload: index >= 0 ? fields[index + 1] : "" };
        }),
      );
    },
    close(): void {
      connection.disconnect();
    },
  };
}

/** D240: the system email jobs. A stream with one consumer group, so a job outlives a consumer that is down. */
export const MAIL_STREAM = "awp:mail";
const MAIL_GROUP = "mailers";

/** Points the consumer at notices to send. The database row is the record; a lost job is sent by the sweep. */
export async function enqueueMailJobs(ids: string[]): Promise<void> {
  if (!liveUpdatesConfigured()) return;
  for (const id of ids) {
    try {
      await valkey().xadd(MAIL_STREAM, "MAXLEN", "~", 10000, "*", "notification", id);
    } catch (problem) {
      logger().warn({ problem, notification: id }, "a mail job was not queued; the sweep sends it");
    }
  }
}

/** The consumer's own connection: a blocking read holds the connection it runs on. */
export function mailJobReader(consumer: string) {
  const connection = connect();
  let grouped = false;
  return {
    /**
     * Up to 20 new mail jobs for this consumer, waiting at most `blockMs`. Creates the stream and
     * the consumer group on the first read.
     */
    async read(blockMs: number): Promise<Array<{ entry: string; notification: string }>> {
      if (!grouped) {
        // BUSYGROUP means it is there already, which is what this asks for.
        await connection.xgroup("CREATE", MAIL_STREAM, MAIL_GROUP, "0", "MKSTREAM").catch(() => undefined);
        grouped = true;
      }
      const response = (await connection.xreadgroup(
        "GROUP",
        MAIL_GROUP,
        consumer,
        "COUNT",
        20,
        "BLOCK",
        blockMs,
        "STREAMS",
        MAIL_STREAM,
        ">",
      )) as Array<[string, Array<[string, string[]]>]> | null;
      if (!response) return [];
      return response.flatMap(([, entries]) =>
        entries.map(([entry, fields]) => ({ entry, notification: fields[fields.indexOf("notification") + 1] ?? "" })),
      );
    },
    async ack(entry: string): Promise<void> {
      await connection.xack(MAIL_STREAM, MAIL_GROUP, entry);
    },
  };
}

