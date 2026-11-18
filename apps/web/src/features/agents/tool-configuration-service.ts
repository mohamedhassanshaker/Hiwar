import { requirePermission } from "@/lib/session";

import * as repository from "./repository";
import { grantableCatalogue, type GrantableTool } from "./platform-catalogue";

/** S-51 tool grant: what one agent may be granted, what it is granted, and what its skills ask for. */

export type ToolConfiguration = {
  catalogue: GrantableTool[];
  /** The names stored on the revision being edited, `ai.agent_platform_tool`. */
  granted: string[];
  /** Connector tools the run would actually be offered, named `connector/tool`. */
  connectorTools: string[];
  /** The attached skills and the tools each one's frontmatter declares. */
  skills: { id: string; name: string; declaredTools: string[] }[];
};

/**
 * What the Connector tools tab renders for the Platform connector (D228).
 *
 * The grant is read from the revision an edit lands on — the open draft, or the active
 * version when there is none — like every other part of the agent detail.
 */
export async function loadToolConfiguration(code: string): Promise<ToolConfiguration | null> {
  await requirePermission("agents:read");

  const agent = await repository.readRunnableAgent(code);
  if (!agent) return null;

  const connectorCodes = await repository.enabledConnectorCodes();
  const editing = await repository.editingVersionOf(agent.id, agent.versionId);
  const [granted, payload] = await Promise.all([
    repository.platformToolGrant(editing.id),
    // The run's own payload, so "what this skill may call" is answered by the thing that
    // answers it at run time rather than by a second reading of the same tables.
    repository.runPayloadFor(editing.id, connectorCodes),
  ]);

  const catalogue = grantableCatalogue();

  return {
    catalogue,
    granted,
    connectorTools: payload.tools.map((tool) => tool.name),
    skills: payload.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      declaredTools: skill.declared_tools,
    })),
  };
}
