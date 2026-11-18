import { pino, type Logger } from "pino";

import { env } from "./env";

/**
 * Requirement 35 and `nextjs-rules.md` rule 12: server-side logging is structured JSON on
 * stdout, which is what the cluster's log collector reads. There is no pretty printer and
 * no transport: the platform's own Logs screen reads the collected stream.
 *
 * Anything that can carry a secret or unmasked personal data is redacted by pino before
 * the line is written, so a careless `log.error({ person }, …)` cannot leak an email or a
 * token into the log.
 */
const REDACTED = ["password", "secret", "token", "key", "authorization", "cookie", "email", "mobile"];

/** `password` at any depth, plus the same name one level inside any object. */
const paths = REDACTED.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]);

let cached: Logger | null = null;

/** The process's pino logger, built on first use, with the secret and personal fields redacted. */
export function logger(): Logger {
  if (!cached) {
    cached = pino({
      level: env().LOG_LEVEL,
      redact: { paths, censor: "[redacted]" },
      base: { service: "awp-web" },
    });
  }
  return cached;
}

/**
 * What an error boundary's server counterpart logs: the whole error, with the screen it
 * happened on, never shown to the person who hit it.
 */
export function logServerError(where: string, error: unknown, detail: Record<string, unknown> = {}): void {
  logger().error({ where, err: error, ...detail }, `${where} failed`);
}
