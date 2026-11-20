import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgresql://hiwar:hiwar@localhost:5433/hiwar"),
  // A direct (unpooled) connection for LISTEN: a transaction-mode pooler does not deliver NOTIFY.
  DATABASE_LISTEN_URL: z.string().min(1).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SECRET_KEY: z.string().optional(),
  AGENT_SERVICE_URL: z.string().url().default("http://localhost:8088"),
  AGENT_SERVICE_TOKEN: z.string().default("dev-agent-token"),
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  MAIL_FROM: z.string().default("Hiwar <no-reply@hiwar.local>"),
  FILES_DIR: z.string().default("../../.data/files"),
  NODE_ENV: z.string().default("development"),
});

let cached: z.infer<typeof schema> | null = null;

/** The validated environment, read once. */
export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
