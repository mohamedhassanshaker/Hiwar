import { z } from "zod";

import { CONNECTOR_AUTH_TYPES, CONNECTOR_TRANSPORTS, TOOL_TIERS } from "@/db/schema/enums";
import { credentialInput } from "./credential";

/** Requirement 32: the connector action inputs. */

export const setConnectorEnabledInput = z.object({
  code: z.string().min(1),
  enabled: z.boolean(),
  version: z.number().int().positive(),
});

export const setToolTierInput = z.object({
  connectorCode: z.string().min(1),
  toolName: z.string().min(1),
  tier: z.enum(TOOL_TIERS),
});

export type SetConnectorEnabledInput = z.infer<typeof setConnectorEnabledInput>;
export type SetToolTierInput = z.infer<typeof setToolTierInput>;

/** `UC-54.1-02`: the connector to shake hands with. */
export const testConnectorInput = z.object({
  connectorId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  transport: z.enum(["stdio", "http"]),
  url: z.string().trim().optional(),
  /** A `stdio` connector's command, already split into its executable and arguments. */
  command: z.array(z.string().trim().min(1)).max(50).optional(),
  authType: z.string().trim().optional(),
  /** The credential as the drawer holds it, for a connector not saved yet; a saved one's is merged in. */
  credential: credentialInput.optional(),
  /** The tier an unannotated tool is listed at, so the drawer shows what it would store. */
  defaultTier: z.enum(TOOL_TIERS).default("T1"),
});

/**
 * Which connector an action is about.
 *
 * `dryRun` is what `UC-54.2-05` needs: the confirmation has to name the agents that would
 * lose their tools before anything is removed, which is a question, not a removal.
 */
export const connectorCodeInput = z.object({
  connectorCode: z.string().trim().min(1),
  dryRun: z.boolean().default(false),
});

/**
 * `UC-54.1-03` and `UC-54.2-01`: the whole connector as the drawer holds it.
 *
 * One input for both add and edit, because the drawer is one form: the difference is
 * whether `version` is present, which is also what makes a concurrent edit visible.
 */
export const saveConnectorInput = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    // The code is what an agent names a tool by (`connector/tool`), so it is a stable
    // identifier rather than a label.
    .regex(/^[a-z0-9][a-z0-9-]*$/, "The code may use lowercase letters, digits and hyphens."),
  /** The name people read; the code is what agents call it by. Blank falls back to the code. */
  nameEn: z.string().trim().max(200).optional(),
  nameAr: z.string().trim().max(200).optional(),
  catalogueId: z.uuid().nullish(),
  transport: z.enum(CONNECTOR_TRANSPORTS),
  url: z.string().trim().max(2000).default(""),
  /** A `Stdio` connector's command line, e.g. `npx -y @modelcontextprotocol/server-foo`. */
  command: z.string().trim().max(2000).default(""),
  authType: z.enum(CONNECTOR_AUTH_TYPES),
  /** Write-only (D296): absent keeps the stored credential; its type is the connector's `authType`. */
  credential: credentialInput.optional(),
  defaultTier: z.enum(TOOL_TIERS),
  enabled: z.boolean(),
  tools: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        tier: z.enum(TOOL_TIERS),
        description: z.string().max(2000).default(""),
      }),
    )
    .max(500)
    .default([]),
  /** Present on an edit only; absent means this is a new connector. */
  version: z.number().int().positive().optional(),
});

export type SaveConnectorInput = z.infer<typeof saveConnectorInput>;

/**
 * `UC-54.1-09`: register a REST API from its own OpenAPI or Swagger document.
 *
 * The document arrives as text rather than a file handle because a server action takes
 * values, and an API description is text whichever way it was produced.
 */
export const importApiConnectorInput = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "The code may use lowercase letters, digits and hyphens."),
  /** The name people read; blank takes the document's title. */
  nameEn: z.string().trim().max(200).optional(),
  nameAr: z.string().trim().max(200).optional(),
  /** The specification itself: OpenAPI 3.x or Swagger 2.0, JSON or YAML. */
  document: z.string().min(2).max(5_000_000),
  /** Overrides the document's own server URL, which is often a placeholder. */
  serverUrl: z.string().trim().max(2000).default(""),
  authType: z.enum(CONNECTOR_AUTH_TYPES),
  /** Write-only (D296); its type is the connector's `authType`. */
  credential: credentialInput.optional(),
  defaultTier: z.enum(TOOL_TIERS).default("T1"),
  enabled: z.boolean().default(false),
});

export type ImportApiConnectorInput = z.infer<typeof importApiConnectorInput>;

/** D296: start an administrator's Connect of an OAuth connector. */
export const connectOAuthInput = z.object({ connectorCode: z.string().trim().min(1) });
