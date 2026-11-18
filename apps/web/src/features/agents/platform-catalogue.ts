import { PLATFORM_TOOLS } from "@/mcp/tools";
import { HARNESS_BUILTIN_TOOLS, HARNESS_PLUMBING_TOOLS } from "./run-payload";

/**
 * One grantable tool of the Platform connector (#20b, D38, D80, D228).
 *
 * `tier` is the catalogue's own, so the T2 warning is read from where the platform declares
 * the risk. `harness` marks the built-ins the harness answers inside the run: they never
 * reach the platform MCP server, so the grant alone decides whether they are offered.
 */
export type GrantableTool = { name: string; tier: string | null; harness: boolean };

/**
 * Everything an agent's platform-tool grant may name: the Platform connector's tools.
 *
 * The harness plumbing lives on the harness token and is never granted to a model (D33).
 */
export function grantableCatalogue(): GrantableTool[] {
  const plumbing = new Set<string>(HARNESS_PLUMBING_TOOLS);
  const harnessAnswered = new Set<string>(HARNESS_BUILTIN_TOOLS);
  const catalogue: GrantableTool[] = PLATFORM_TOOLS.filter((entry) => !plumbing.has(entry.name)).map((entry) => ({
    name: entry.name,
    tier: entry.tier,
    harness: harnessAnswered.has(entry.name),
  }));

  const listed = new Set(catalogue.map((entry) => entry.name));
  for (const name of HARNESS_BUILTIN_TOOLS) {
    // A built-in with no catalogue entry has no platform implementation and so no tier.
    if (!listed.has(name)) catalogue.push({ name, tier: null, harness: true });
  }
  return catalogue.sort((left, right) => left.name.localeCompare(right.name));
}
