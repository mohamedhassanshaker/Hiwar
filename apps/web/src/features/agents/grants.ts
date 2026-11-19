/**
 * Every tool name one run may call: the platform tools it is configured for and its
 * connector tools.
 *
 * This is what the run token carries and what the MCP server enforces, so a tool outside
 * it is refused however the model came to know its name.
 */
export function grantedToolNames(input: {
  /**
   * The agent version's stored grant, `ai.agent_platform_tool` (D38). Empty is a real
   * answer: an agent granted nothing reaches no platform tool, which is what a grant
   * that has to be configured means.
   */
  platformTools: string[];
  connectorTools: string[];
}): string[] {
  // The plumbing is deliberately absent: it lives on the harness token, so the model is
  // neither told about it nor able to call it.
  return [...input.platformTools, ...input.connectorTools];
}

/**
 * A child run's grant: the parent's, narrowed to what the child's own configuration
 * allows (D36).
 *
 * A child can never reach further than the run that delegated to it. Both bounds matter:
 * the parent's, because delegation must not be a way to widen a grant; the child's,
 * because an agent configured without a tool does not acquire it by being delegated to.
 *
 * `parentGrant` is null for a run that started before the grant was recorded on the row.
 * Such a parent's reach is unknown, and the safe reading of an unknown grant is the
 * child's configuration alone — never "everything the parent might have had".
 */
export function childGrant(parentGrant: string[] | null, childConfiguration: string[]): string[] {
  if (parentGrant === null) return [...childConfiguration];
  const parent = new Set(parentGrant);
  return childConfiguration.filter((tool) => parent.has(tool));
}

/**
 * A resumed run's grant: its recorded snapshot, narrowed to what the agent's
 * configuration allows now (D50).
 *
 * It can shrink and never grow. A tool revoked while the run was waiting is gone when it
 * resumes, which is the point of revoking it; a tool granted while it was waiting does
 * not apply retroactively to work already under way.
 */
export function resumeGrant(snapshot: string[] | null, currentConfiguration: string[]): string[] {
  if (snapshot === null) return [];
  const current = new Set(currentConfiguration);
  return snapshot.filter((tool) => current.has(tool));
}
