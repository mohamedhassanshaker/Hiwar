import { z } from "zod";

import { action } from "@/mcp/action-tool";
import type { PlatformTool } from "@/mcp/tools";

import * as service from "./service";

/**
 * S-76 and S-77 as tools: what the Integrations screens do, offered to an agent working
 * on someone's behalf — which here is reading, and nothing else.
 *
 * This screen is the platform's own authorisation surface for everything outside it. A
 * client carries a permission list and an agent list; a key is a credential the service
 * returns once and never again; the MCP exposure names the tools an outside caller may
 * call, and the AG-UI exposure the origins it may call from. Every write on the screen
 * widens or narrows what someone can reach, so none of them is in the catalogue at any
 * tier. They stay console actions, where a person is the decision.
 */
export const INTEGRATION_TOOLS: PlatformTool[] = [
  action({
    subject: "integration_client",
    operation: "list",
    description:
      "Every integration client registered, with its owner, status, keys and their " +
      "expiry, the permissions and agents it is limited to, and its MCP and AG-UI " +
      "exposure. Also the tools and permissions a client may be given, and this " +
      "platform's own endpoints. Key secrets are stored hashed and are never returned. " +
      "Read this to explain why an outside caller was refused.",
    input: z.object({}),
    permission: "integrations:read",
    run: () => service.loadIntegrations(),
  }),
];
