import { z } from "zod";

import { CONNECTOR_AUTH_TYPES, CONNECTOR_TRANSPORTS, TOOL_TIERS } from "@/db/schema/enums";
import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import * as repository from "./repository";
import { importApiConnectorInput, saveConnectorInput, setConnectorEnabledInput, setToolTierInput } from "./schema";
import * as service from "./service";

/**
 * S-54 as tools: what the Connectors screen does, offered to an agent working on someone's
 * behalf (D277, the owner's decision amending D108).
 *
 * Registering, editing and enabling a connector and setting a tool's tier decide what agents
 * may call, so each is T2 and marked `authorisation`: somebody other than the requester reads
 * the exact payload first (D253), except in the assistant panel, where the requester does
 * (D284). Testing and refreshing change nothing an agent may reach. No tool takes a credential:
 * a key or token is typed by a person in the console, so it never passes through a model, its
 * history or an approval.
 */

type Tier = (typeof TOOL_TIERS)[number];

/** A stored connector, as the console holds it. */
async function stored(code: string) {
  const found = (await repository.listConnectors()).find((connector) => connector.n === code);
  if (!found) throw new service.ConnectorRejected(`There is no connector ${code}.`, `لا يوجد موصل ${code}.`);
  return found;
}

export const CONNECTOR_TOOLS: PlatformTool[] = [
  action({
    subject: "connector",
    operation: "list",
    description:
      "Every registered connector: its code, what it is, its transport and address, its " +
      "status, whether it is enabled, its version, and the tools it offers with the tier and " +
      "availability of each. Also the catalogue of connectors that could be installed. Read " +
      "this to explain why a tool call was refused, or to find the name of a tool before " +
      "asking a person to grant it.",
    input: z.object({}),
    permission: "connectors:read",
    run: () => service.loadConnectors(),
  }),

  action({
    subject: "connector_operation",
    operation: "list",
    description:
      "The HTTP operations a REST connector registered from its OpenAPI document: the " +
      "method, path, parameters and body each tool stands for. Use this to see what one " +
      "of its tools would actually send.",
    input: z.object({ connectorCode: z.string().trim().min(1) }),
    permission: "connectors:read",
    run: async ({ connectorCode }) => ({ operations: await service.apiOperations(connectorCode) }),
  }),

  action({
    subject: "connector",
    operation: "create",
    description:
      "Register an MCP server as a connector: its code, names, transport (StreamableHttp with a " +
      "URL, or Stdio with a command), authorisation type, the tier for tools its server does not " +
      "annotate, and whether it is enabled. An enabled connector is handshaken first. A server " +
      "that needs a credential gets it from a person in the console: register it Disabled and say so.",
    input: saveConnectorInput.omit({ credential: true, version: true }).extend({ transport: z.enum(["StreamableHttp", "Stdio"]) }),
    permission: "connectors:write",
    tier: "T2",
    authorisation: true,
    run: (input) => service.saveConnector(input),
  }),

  action({
    subject: "connector_api",
    operation: "create",
    description:
      "Register a REST API as a connector from its OpenAPI or Swagger document (the document's " +
      "text): every operation becomes a tool, a GET at T0 and anything else at `defaultTier`. An " +
      "API whose authorisation needs a credential is stored Disabled until a person adds the " +
      "credential in the console (`awaitsCredential` in the result).",
    input: importApiConnectorInput.omit({ credential: true }),
    permission: "connectors:write",
    tier: "T2",
    authorisation: true,
    run: (input) => service.importApiConnector(input),
  }),

  action({
    subject: "connector",
    operation: "edit",
    description:
      "Change a connector's names, URL, command, authorisation type or default tier. Name only " +
      "the fields to change. `expectedVersion` is the version `connector_list` returned; a " +
      "connector changed since is refused. The stored credential is kept: only a person changes it.",
    input: z
      .object({
        code: z.string().trim().min(1),
        nameEn: z.string().trim().max(200).optional(),
        nameAr: z.string().trim().max(200).optional(),
        url: z.string().trim().max(2000).optional(),
        command: z.string().trim().max(2000).optional(),
        authType: z.enum(CONNECTOR_AUTH_TYPES).optional(),
        defaultTier: z.enum(TOOL_TIERS).optional(),
        expectedVersion: z.number().int().positive(),
      })
      .strict(),
    permission: "connectors:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      const current = await stored(input.code);
      return service.saveConnector({
        code: input.code,
        nameEn: input.nameEn ?? current.name,
        nameAr: input.nameAr ?? current.nameAr,
        catalogueId: current.catalogueId,
        transport: current.transport as (typeof CONNECTOR_TRANSPORTS)[number],
        url: input.url ?? current.url,
        command: input.command ?? current.command,
        authType: input.authType ?? (current.auth as (typeof CONNECTOR_AUTH_TYPES)[number]),
        defaultTier: input.defaultTier ?? (current.def as Tier),
        enabled: current.on,
        tools: current.tools.map((tool) => ({ name: tool.name, tier: tool.tier as Tier, description: "" })),
        version: input.expectedVersion,
      });
    },
  }),

  action({
    subject: "connector_activation",
    operation: "edit",
    description:
      "Turn a connector on or off. On makes its tools reachable by every agent granted them; off " +
      "takes them out of every run. `version` is the version `connector_list` returned.",
    input: setConnectorEnabledInput,
    permission: "connectors:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      await service.setConnectorEnabled(input);
      return { code: input.code, enabled: input.enabled };
    },
  }),

  action({
    subject: "connector_tool",
    operation: "edit",
    description:
      "Set one connector tool's tier: T0 reads and runs unattended, T1 runs and is recorded, T2 " +
      "waits for a person's approval on every call.",
    input: setToolTierInput,
    permission: "connectors:write",
    tier: "T2",
    authorisation: true,
    run: async (input) => {
      await service.setToolTier(input);
      return { connectorCode: input.connectorCode, toolName: input.toolName, tier: input.tier };
    },
  }),

  action({
    subject: "connector_test",
    operation: "create",
    description:
      "Check that a stored connector answers: an MCP server's handshake and the tools it lists, " +
      "or one authorised request to a REST API, which records its status.",
    input: z.object({ connectorCode: z.string().trim().min(1) }),
    permission: "connectors:write",
    run: async ({ connectorCode }) => {
      const current = await stored(connectorCode);
      if (current.transport === "OpenApi") return service.testApiConnector(connectorCode);
      return service.testConnector({
        connectorId: connectorCode,
        name: current.name || connectorCode,
        transport: current.transport === "Stdio" ? "stdio" : "http",
        url: current.url,
        command: current.transport === "Stdio" ? repository.splitCommand(current.command) : undefined,
        authType: current.auth,
        defaultTier: current.def as Tier,
      });
    },
  }),

  action({
    subject: "connector_refresh",
    operation: "create",
    description:
      "Read an MCP connector's tool list from its server again. A tool that arrived is unavailable " +
      "until its tier is set; one that went is marked unavailable.",
    input: z.object({ connectorCode: z.string().trim().min(1) }),
    permission: "connectors:write",
    run: ({ connectorCode }) => service.refreshConnectorTools(connectorCode),
  }),

  action({
    subject: "connector",
    operation: "delete",
    description: "Remove a connector and its tools. Every agent granted one of them loses it; the result names them.",
    input: z.object({ connectorCode: z.string().trim().min(1) }),
    permission: "connectors:write",
    run: ({ connectorCode }) => service.removeConnector(connectorCode, false),
  }),
];
