import type { PermissionCode } from "@/authz/permissions";
import { z } from "zod";

import * as knowledge from "@/features/knowledge/service";
import * as memory from "@/features/memory/service";
import * as pageReader from "@/features/assistant/page-reader";
import * as runs from "@/features/agents/run-service";
import { AGENT_TOOLS } from "@/features/agents/tools";
import { BUDGET_TOOLS } from "@/features/budgets/tools";
import { CONNECTOR_TOOLS } from "@/features/connectors/tools";
import { ENGAGE_TOOLS } from "@/features/engage/tools";
import { INTEGRATION_TOOLS } from "@/features/integrations/tools";
import { KNOWLEDGE_TOOLS } from "@/features/knowledge/tools";
import { MEMORY_TOOLS } from "@/features/memory/tools";
import { SKILL_TOOLS } from "@/features/skills/tools";

/**
 * The tools the platform MCP server offers an agent
 * (`packages/contracts/schemas/platform-mcp-tools.schema.json`).
 *
 * Every one of them calls the same service a person's action calls, so the permission
 * check, the validation and the audit are the ones already written — this module adds a
 * schema and a name, nothing else. That is the ownership rule of stack specification 4.2:
 * the agent service never touches `awp` itself.
 *
 * The tier is what the harness reads to decide whether a call runs, asks for confirmation
 * or pauses for an Inbox approval (specification 5.3). It is declared here because the
 * platform, not the agent, owns the risk of its own tools.
 */

export type ToolTier = "T0" | "T1" | "T2" | "T3";

export type PlatformTool = {
  name: string;
  tier: ToolTier;
  description: string;
  /** The permission the service behind it checks. Declared so the catalogue is readable. */
  permission: PermissionCode;
  input: z.ZodType;
  run: (input: never) => Promise<unknown>;
  /**
   * The fields of this particular payload a person has to agree to before it runs.
   *
   * A tool declares its base tier, and the server escalates per field (D58): one edit of
   * a step is an ordinary change when it renames it and a decision when it makes it
   * terminal. Declared as a function of the payload because only the payload can say
   * which it is, and of the person the call acts for where the record decides it, as a
   * requester approving their own request does. Empty, or absent, means the base tier stands.
   */
  escalates?: (input: unknown, personId: string) => string[] | Promise<string[]>;
  /**
   * Changes who may do what: an agent's configuration or grant, or what a public
   * deployment lets a visitor reach (D253). Such a tool is T2, and its approval goes to
   * the holders of `approvals:decide` other than the requester, in a room too; in the
   * assistant panel the requester decides it (D284).
   */
  authorisation?: true;
  /**
   * Reads only records the run's agent is granted one by one, so a room's other members do
   * not bound it: the agent answers from its own sources (D291).
   */
  agentGranted?: true;
};

/** A tool definition that keeps its input type through to its handler. */
function tool<S extends z.ZodType>(
  definition: Omit<PlatformTool, "input" | "run"> & {
    input: S;
    run: (input: z.infer<S>) => Promise<unknown>;
  },
): PlatformTool {
  return definition as unknown as PlatformTool;
}

const STATIC_TOOLS: PlatformTool[] = [



  tool({
    name: "page_read",
    tier: "T0",
    permission: "inbox:read",
    description:
      "Read what is on a console screen, as that screen itself reads it. `path` is the " +
      "console path the question is about — the assistant is told which one. Use this to " +
      "answer \"summarise this page\" from the page's real content rather than from its " +
      "title. A screen the acting person may not open refuses here too.",
    input: z.object({ path: z.string().trim().min(1).max(500) }),
    run: async ({ path }) => pageReader.readPage(path),
  }),

  tool({
    name: "my_attention",
    tier: "T0",
    permission: "inbox:read",
    description:
      "What is waiting on the acting person, most blocking first: approvals and questions " +
      "a run is paused on, SLA risks and reviews, mentions, then their own open work by " +
      "due date. Each entry carries the console path that opens it, so an answer can link " +
      "to the thing rather than only name it.",
    input: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
    run: async ({ limit }) => ({ items: await pageReader.myAttention(limit) }),
  }),




  tool({
    name: "knowledge_search",
    tier: "T0",
    permission: "knowledge:read",
    agentGranted: true,
    description:
      "Ask the knowledge base a question and read what comes back: passages and facts with " +
      "their scores. Searches the collections this agent is granted that the person may read; " +
      "name one with collectionId to search only it. Ground an answer in what is indexed, and " +
      "say where it came from.",
    input: z.object({
      query: z.string().trim().min(1).max(500),
      collectionId: z.string().trim().min(1).optional(),
      mode: z.enum(["Vector", "Graph", "Hybrid"]).default("Hybrid"),
      limit: z.number().int().min(1).max(50).default(8),
    }),
    run: (input) => knowledge.searchKnowledge(input),
  }),

  tool({
    name: "memory_search",
    tier: "T0",
    permission: "memory:read",
    description:
      "Search the memory this run may read: the organisation's and this agent's own, Active entries only.",
    input: z.object({
      query: z.string().max(200).default(""),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    run: async (input) => ({ memories: await memory.searchForRun(input.query, input.limit) }),
  }),

  /**
   * D68: one write tool, into this agent's memory of the person the run acts for.
   *
   * `memory_propose` stood beside this one calling the same service with the same
   * arguments, so the catalogue offered the model two names for one action and the
   * second had no spec the harness could advertise (D78). It is gone rather than
   * renamed: one subject, one write.
   *
   * No scope or path argument. The server derives the scope from the run token's agent
   * and the acting person, which is the only way "never shared across users" can be a
   * property of the platform rather than of the model's good behaviour. The harness's
   * own spec sends `scope` and `confidence`; both are dropped here, because neither can
   * be allowed to decide anything.
   */
  tool({
    name: "memory_write",
    tier: "T1",
    permission: "memory:write",
    description:
      "Remember something about the person this run is acting for. It goes into this " +
      "agent's memory of that person: a later run for them reads it back through " +
      "memory_search, and a run for anybody else never sees it. There is no scope to " +
      "choose. Write one fact per call, in a sentence that will still make sense months " +
      "later without this conversation around it.",
    input: z.object({ content: z.string().min(1).max(8000) }),
    run: async (input) => memory.rememberForRun(input.content),
  }),

  tool({
    name: "approval_create",
    tier: "T0",
    permission: "agents:invoke",
    description:
      "Create the Inbox approval a T2 tool call waits on. The run resumes when it is decided.",
    input: z.object({
      run_id: z.uuid(),
      tool_name: z.string().min(1).max(200),
      call_id: z.string().min(1).max(120),
      arguments: z.record(z.string(), z.unknown()).default({}),
      tier: z.string().max(8).default("T2"),
      reason: z.string().max(2000).default(""),
      context_type: z.string().max(40).default(""),
      context_id: z.string().max(80).default(""),
    }),
    run: async (input) =>
      runs.requestApproval({ ...input, separateApprover: TOOLS_BY_NAME.get(input.tool_name)?.authorisation === true }),
  }),

  tool({
    name: "agent_question_create",
    tier: "T0",
    permission: "agents:invoke",
    description: "Ask the person this run acts for a question. The run waits for the answer.",
    input: z.object({
      run_id: z.uuid(),
      question: z.string().min(1).max(4000),
      // `UC-12.2-03`: when the agent offers a choice, the person picks one of these.
      options: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
      context_type: z.string().max(40).default(""),
      context_id: z.string().max(80).default(""),
    }),
    run: async (input) => runs.askPerson(input),
  }),

  tool({
    name: "run_start",
    tier: "T0",
    permission: "agents:invoke",
    description:
      "Register a delegated run's own row, under the agent it names, and return what the " +
      "harness needs to run as that agent: its instructions, route, skills, tools, knowledge, " +
      "memory and budget, and a token scoped to them.",
    input: z.object({
      run_id: z.uuid(),
      /**
       * The run delegating this one, which has to be the run the calling token was minted
       * for. A new run's own id cannot bind the call — it does not exist yet — so the one
       * it comes from does.
       */
      parent_run_id: z.uuid(),
      agent_code: z.string().min(1).max(60),
      context_type: z.string().max(40).default(""),
      context_id: z.string().max(80).default(""),
    }),
    run: async (input) => runs.startRun(input),
  }),

  tool({
    name: "run_token_refresh",
    tier: "T0",
    permission: "agents:invoke",
    description:
      "Replace this run's credentials before they expire. Returns a fresh model token, a " +
      "fresh plumbing token and the grant they carry. Refused for a run that has finished " +
      "or been cancelled.",
    input: z.object({ run_id: z.uuid() }),
    run: async (input) => runs.refreshCredentials(input),
  }),

  tool({
    name: "run_finish",
    tier: "T0",
    permission: "agents:invoke",
    description:
      "Record what the run produced: its status, totals, output and handoff, and account its cost.",
    input: z.object({
      run_id: z.uuid(),
      status: z.string().min(1).max(40),
      output: z.string().max(100_000).default(""),
      handoff: z
        .object({
          goal: z.string().max(4000).default(""),
          // The harness writes these as lists, which is what they are: the decisions taken
          // and the questions still open, not one paragraph each.
          decisions: z.array(z.string().max(2000)).max(50).default([]),
          open_questions: z.array(z.string().max(2000)).max(50).default([]),
          next_step: z.string().max(4000).default(""),
        })
        .nullish(),
      tokens_in: z.number().int().min(0).default(0),
      tokens_out: z.number().int().min(0).default(0),
      tool_call_count: z.number().int().min(0).default(0),
      // Decimal over the wire: a money value that went through a float is not the value
      // that was measured.
      estimated_cost_aed: z.union([z.string(), z.number()]).default("0"),
      eval_scores: z.record(z.string(), z.number()).default({}),
      // The run viewer's timeline: every model, tool, approval and verify step the harness
      // recorded, in order. Empty for a run the harness built before this carried one.
      steps: z
        .array(
          z.object({
            seq: z.number().int().positive(),
            type: z.string().min(1).max(20),
            name: z.string().min(1).max(200),
            status: z.string().min(1).max(40),
            result: z.string().max(10_000).default(""),
            hooks_applied: z.array(z.string().max(80)).default([]),
            estimated_cost_aed: z.union([z.string(), z.number()]).default("0"),
            started_at: z.iso.datetime({ offset: true }),
            ended_at: z.iso.datetime({ offset: true }),
          }),
        )
        .default([]),
    }),
    run: async (input) => runs.finishRun(input),
  }),
];

/**
 * The whole catalogue: the tools written here, plus each feature's own registry.
 *
 * A feature's registry is built from the actions its screens already call, so the console
 * and an agent reach the platform the same way — same schema, same service, same
 * permission check. Adding an action to a registry is what makes it callable by an agent;
 * nothing here needs to change for it.
 */
export const PLATFORM_TOOLS: PlatformTool[] = [
  ...STATIC_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...SKILL_TOOLS,
  ...CONNECTOR_TOOLS,
  ...ENGAGE_TOOLS,
  ...MEMORY_TOOLS,
  ...INTEGRATION_TOOLS,
  ...BUDGET_TOOLS,
  ...AGENT_TOOLS,
];

const duplicates = PLATFORM_TOOLS.map((entry) => entry.name).filter(
  (name, index, all) => all.indexOf(name) !== index,
);
if (duplicates.length > 0) {
  // Two tools with one name is a catalogue where the model cannot say which it meant,
  // and `TOOLS_BY_NAME` would silently keep the last.
  throw new Error(`the platform tool catalogue names ${duplicates.join(", ")} more than once`);
}

export const TOOLS_BY_NAME = new Map(PLATFORM_TOOLS.map((entry) => [entry.name, entry]));
