import { z } from "zod";

/**
 * Stack specification section 9. Every variable the web application reads is declared
 * here and validated once, at start-up, so a missing or malformed value fails the process
 * with a readable message instead of surfacing as a runtime error on a screen.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),

  // Domain database: the pooled writer, the replica, and the direct migrate connection.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (the awp-db pooler)"),
  DATABASE_RO_URL: z.string().min(1).optional(),
  DATABASE_MIGRATE_URL: z.string().min(1).optional(),

  // Envelope encryption (specification section 9, Secrets). 32 bytes, base64.
  APP_KEK: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "APP_KEK must be 32 bytes of base64")
    .optional(),

  AUTH_SECRET: z.string().min(1).optional(),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
  /**
   * D387: UAE PASS sign-in. Without a client id and secret the sign-in page offers the password
   * only. The base URL is the staging host until UAE PASS onboarding issues production
   * credentials, which are used with `https://id.uaepass.ae`.
   */
  UAEPASS_BASE_URL: z.url().default("https://stg-id.uaepass.ae"),
  UAEPASS_CLIENT_ID: z.string().min(1).optional(),
  UAEPASS_CLIENT_SECRET: z.string().min(1).optional(),
  UAEPASS_ACR_VALUES: z.string().min(1).default("urn:safelayer:tws:policies:authentication:level:low"),

  AGENT_SERVICE_URL: z.url().optional(),
  PLATFORM_MCP_URL: z.url().optional(),
  RUN_TOKEN_SIGNING_KEY: z.string().min(1).optional(),
  /**
   * What the `maintenance` Temporal workflow proves it is, firing a scheduled work item
   * (flow F-06). There is no cookie and no run token for a Schedule, so this is the one
   * thing standing between the internal firing route and anybody who can reach the pod.
   */
  MAINTENANCE_API_TOKEN: z.string().min(1).optional(),

  TEMPORAL_ADDRESS: z.string().min(1).optional(),
  TEMPORAL_NAMESPACE: z.string().min(1).default("awp"),

  AGW_LLM_URL: z.url().optional(),
  AGW_MCP_BASE_URL: z.url().optional(),
  /**
   * The connector runtime, which is how this platform speaks MCP (S-54).
   *
   * The console configures a connector and hands it to the runtime; the handshake and
   * every later tool call go through that one service, so "the connector went down" is a
   * single thing to observe rather than a failure mode in two codebases.
   */
  CONNECTOR_RUNTIME_URL: z.url().optional(),
  /**
   * The one workload allowed out of the cluster (stack specification 7).
   *
   * Testing a model connection means calling the provider where it lives, and every pod but
   * the egress proxy is closed to the internet by `infra/policies/network-policies.yaml`.
   * A provider outside the proxy's allow-list is refused there, which is the platform
   * saying it may not reach that host rather than the credential being wrong.
   */
  EGRESS_PROXY_URL: z.url().optional(),
  // Where the console renders agentgateway's routes (stack specification 8.3).
  AI_NAMESPACE: z.string().min(1).default("awp-ai"),
  // The Gateway those routes attach to.
  AI_GATEWAY_NAME: z.string().min(1).default("ai-gateway"),

  /**
   * Hosts a skill package may be fetched from, comma-separated (`UC-53.2-03`).
   *
   * A skill is instructions the agents will follow, so fetching one from any host an
   * admin names is how a supply chain is compromised. An empty list means no Git import.
   */
  SKILL_GIT_HOSTS: z.string().optional(),
  PHOENIX_BASE_URL: z.url().optional(),
  /**
   * Where a person's browser reaches Phoenix (`UC-52.1-07`).
   *
   * Separate from `PHOENIX_BASE_URL`, which is the in-cluster address the trace exporter
   * posts to and which no browser can resolve. A trace link built from that one is a dead
   * link on every machine.
   */
  PHOENIX_PUBLIC_ORIGIN: z.url().optional(),
  PHOENIX_API_KEY: z.string().min(1).optional(),

  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),

  VALKEY_URL: z.string().min(1).optional(),
  NEO4J_URI: z.string().min(1).optional(),
  NEO4J_AUTH: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

/**
 * The values `.env.example` ships so a laptop works out of the box. They are published, so
 * each one is a known key: `APP_KEK` is 32 zero bytes, which makes the envelope encryption
 * of every connector, channel and provider credential reversible by anyone; `AUTH_SECRET`
 * forges a session; `RUN_TOKEN_SIGNING_KEY` forges an agent identity and so reaches the
 * platform MCP server as any agent.
 *
 * Copying `.env.example` to `.env` and deploying it is the obvious mistake, and the schema
 * cannot catch it: the example `APP_KEK` is a well-formed 32-byte key. So production fails
 * closed on them instead (NFR-10, NFR-13, data model rule 8). Development is untouched.
 */
const EXAMPLE_SECRETS: Readonly<Record<string, string>> = {
  APP_KEK: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_SECRET: "dev-secret-change-me",
  RUN_TOKEN_SIGNING_KEY: "dev-run-token-key",
  PHOENIX_SECRET: "dev-phoenix-secret-change-me-32bytes",
  MAINTENANCE_API_TOKEN: "dev-maintenance-token-change-me",
};

/** The example values a deployment is still carrying, in declaration order. */
function exampleSecretsInUse(values: Env): string[] {
  return Object.entries(EXAMPLE_SECRETS)
    .filter(([name, example]) => (values as unknown as Record<string, unknown>)[name] === example)
    .map(([name]) => name);
}

let cached: Env | null = null;

/**
 * Reads and validates the environment. The result is cached, so the cost is paid once and
 * every caller sees the same values.
 *
 * @throws {Error} when a variable is missing or malformed, or when a production process is
 * still carrying a secret published in `.env.example`.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`The environment is not valid:\n${problems}\n\nSee .env.example for every variable and its consumer.`);
  }
  // `next build` runs with NODE_ENV=production and prerenders route handlers, so it reads
  // the environment of the machine doing the build — a developer's, carrying the example
  // values by design. Building is not deploying, and failing the build here would only
  // teach people to remove the check. The phase variable is how Next.js distinguishes them.
  const building = process.env.NEXT_PHASE === "phase-production-build";
  if (parsed.data.NODE_ENV === "production" && !building) {
    const published = exampleSecretsInUse(parsed.data);
    if (published.length > 0) {
      throw new Error(
        `These variables still hold the published example value from .env.example: ${published.join(", ")}.\n` +
          "Anyone can read them, so secrets encrypted with them are not protected. Generate real " +
          "values before starting outside development.",
      );
    }
  }
  cached = parsed.data;
  return cached;
}

/** Only for tests, which build an environment per case. */
export function resetEnvCache(): void {
  cached = null;
}
