/**
 * What an agent brings to a run: its tools, its skills, the knowledge it may retrieve from
 * and the memory scopes it may read or write.
 *
 * Specification section 7.4 defines an agent as "a versioned AI worker with instructions,
 * skills, tools (through connectors), memory, knowledge, a model route, an execution
 * profile, an org position, an agent trust level and a budget". The run body carries all of
 * it: the harness assembles its context and its toolset from what arrives, and anything not
 * sent is something the agent does not have during the run.
 *
 * The shapes are the agent service's own (`awp_agent.harness.types`), in its snake_case, so
 * a field added on one side is a type error on the other rather than a silent default.
 */

export { HARNESS_PLUMBING_TOOLS, DEFAULT_PLATFORM_TOOLS, HARNESS_BUILTIN_TOOLS, DEFAULT_TOOL_GRANT } from "./default-tools";
export { grantedToolNames, childGrant, resumeGrant } from "./grants";

/** One tool the agent may ask for, with the tier that governs it. */
export type RunTool = {
  name: string;
  description: string;
  parameters_json_schema: Record<string, unknown>;
  tier: "T0" | "T1" | "T2" | "T3";
  server: "platform" | "connector" | "sandbox" | "harness";
  connector_id?: string;
};

export type RunSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  declared_tools: string[];
  /** Where an uploaded skill's files are in the object store, `bucket/prefix`; null for a
   * bundled skill, which the agent image carries. */
  package_ref: string | null;
};

export type RunKnowledge = {
  collection_id: string;
  name: string;
  mode: "Vector" | "Graph" | "Hybrid";
  /** The collection's own embedding route — the one its passages were actually embedded
   * with, which a query vector has to match to be comparable at all. */
  embedding_route: string;
};

export type RunMemory = {
  scope: "Organisation" | "BusinessUnit" | "Agent" | "Session";
  scope_id: string | null;
  writable: boolean;
};

export type RunPayload = {
  tools: RunTool[];
  skills: RunSkill[];
  knowledge: RunKnowledge[];
  memory: RunMemory[];
};
