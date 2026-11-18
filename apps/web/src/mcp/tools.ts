import type { PermissionCode } from "@/authz/permissions";
import { z } from "zod";

import { ARTIFACT_LINK_TYPES } from "@/db/schema/enums";
import * as files from "@/features/files/service";
import * as knowledge from "@/features/knowledge/service";
import * as memory from "@/features/memory/service";
import * as pageReader from "@/features/assistant/page-reader";
import * as requests from "@/features/requests/service";
import * as runs from "@/features/agents/run-service";
import * as workItems from "@/features/work-items/service";
import { AGENT_TOOLS } from "@/features/agents/tools";
import { BUDGET_TOOLS } from "@/features/budgets/tools";
import { CONNECTOR_TOOLS } from "@/features/connectors/tools";
import { ENGAGE_TOOLS } from "@/features/engage/tools";
import { FILE_TOOLS } from "@/features/files/tools";
import { GOVERNANCE_TOOLS } from "@/features/governance/tools";
import { INTEGRATION_TOOLS } from "@/features/integrations/tools";
import { KNOWLEDGE_TOOLS } from "@/features/knowledge/tools";
import { MEMORY_TOOLS } from "@/features/memory/tools";
import { ORGANISATION_TOOLS } from "@/features/organisation/tools";
import { PROJECT_TOOLS } from "@/features/projects/tools";
import { REQUEST_TOOLS } from "@/features/requests/tools";
import { ROOM_TOOLS } from "@/features/rooms/tools";
import { SCHEDULE_TOOLS } from "@/features/schedules/tools";
import { SKILL_TOOLS } from "@/features/skills/tools";
import { WORK_ITEM_TOOLS } from "@/features/work-items/tools";

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
    name: "request_read",
    tier: "T0",
    permission: "requests:read",
    description:
      "Read everything about one request: its description, its attributes, the step it is " +
      "at and every step of its flow, its attachments, and its whole history — each " +
      "transition, comment and assignment, oldest first. Call this before working a " +
      "request's step, so the decision is made on what the request actually says rather " +
      "than on its title.",
    input: z.object({ key: z.string().trim().min(1) }),
    run: async ({ key }) => {
      const detail = await requests.loadRequestDetail(key);
      if (!detail) throw new Error(`There is no request ${key}.`);
      return detail;
    },
  }),

  tool({
    name: "work_item_read",
    tier: "T0",
    permission: "work_items:read",
    description:
      "Read everything about one work item: its description, acceptance criteria, sub " +
      "items, attachments, comments and history. The counterpart of `request_read`.",
    input: z.object({ key: z.string().trim().min(1) }),
    run: async ({ key }) => {
      const opened = await workItems.loadWorkItem(key);
      if (!opened) throw new Error(`There is no work item ${key}.`);
      const { item, detail } = opened;
      // The item's own fields and its brief, named for a reader, not the drawer's shorthand.
      return {
        key: item.k,
        title: item.t,
        type: item.type,
        status: item.st,
        assignee: item.who,
        priority: item.pri,
        dueAt: item.dueAt,
        version: item.version,
        description: detail.desc,
        reviewer: detail.rev || null,
        requestType: detail.rt[0] === "—" ? null : detail.rt[0],
        origin: detail.org ? detail.org[0] : null,
        parent: detail.parent ?? null,
        attributes: Object.fromEntries(detail.at),
        subItems: detail.subs.map(([subKey, title, , assignee, done]) => ({ key: subKey, title, assignee, done: done === 1 })),
        activity: detail.act.map(([actor, what]) => ({ actor, what })),
        attachments: detail.attachments.map(([name, size]) => ({ name, size })),
        raisedFromComment: detail.comment ? detail.comment.text : null,
      };
    },
  }),

  tool({
    name: "file_search",
    tier: "T0",
    permission: "files:read",
    description:
      "Search the files and artifacts the acting person may read, by name or title. " +
      "Returns what each one is and where it is attached, so a later read or a citation " +
      "names a real file rather than a guess.",
    input: z.object({
      query: z.string().trim().max(200).default(""),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    run: async ({ query, limit }) => {
      const [artifacts, stored] = await Promise.all([
        files.loadArtifacts({ q: query || undefined }, { limit, offset: 0 }),
        files.loadFiles({ q: query || undefined }, { limit, offset: 0 }),
      ]);
      return { artifacts: artifacts.items, files: stored.items };
    },
  }),

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
    name: "work_item_search",
    tier: "T0",
    permission: "work_items:read",
    description: "Search the work items the acting person may see.",
    input: z.object({
      query: z.string().min(1),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    run: async ({ query, status, limit }) =>
      (await workItems.loadWorkItems({ scope: "all", q: query, status }, { board: false, limit, offset: 0 })).items,
  }),

  tool({
    name: "work_item_create",
    tier: "T1",
    permission: "work_items:write",
    description:
      "Create a work item in a project the acting person may write to. With requestKey it is " +
      "that request's work, in the request's project, and listed on the request.",
    input: z.object({
      projectKey: z.string().min(1),
      titleEn: z.string().min(1).max(200),
      titleAr: z.string().min(1).max(200),
      type: z.enum(["Task", "SubItem", "Bug"]).default("Task"),
      priority: z.enum(["High", "Medium", "Low"]).default("Medium"),
      descriptionEn: z.string().max(4000).optional(),
      assignee: z.string().optional(),
      dueAt: z.string().date().optional(),
      parentKey: z.string().optional(),
      requestKey: z.string().optional(),
    }),
    run: async (input) => ({ key: await workItems.createWorkItem(input) }),
  }),

  tool({
    name: "artifact_create",
    tier: "T1",
    permission: "files:write",
    description:
      "Save a generated file as a versioned artifact in a project, optionally attached to a " +
      "work item, a request or a room. With a link and no project_key it is saved in the " +
      "linked item's project. Pass `generate_document`'s own output straight through — its " +
      "file_name, mime_type and content_base64 — rather than re-encoding it.",
    input: z.object({
      project_key: z.string().trim().min(1).optional(),
      title_en: z.string().trim().min(1).max(200),
      title_ar: z.string().trim().min(1).max(200),
      file_name: z.string().trim().min(1).max(200),
      mime_type: z.string().trim().min(1),
      content_base64: z.string().min(1),
      linked_to_type: z.enum(ARTIFACT_LINK_TYPES).optional(),
      linked_to_key: z.string().trim().min(1).optional(),
      run_id: z.uuid().optional(),
    }),
    run: async (input) => {
      const created = await files.createArtifact({
        projectKey: input.project_key,
        titleEn: input.title_en,
        titleAr: input.title_ar,
        fileName: input.file_name,
        dataUrl: `data:${input.mime_type};base64,${input.content_base64}`,
        linkedToType: input.linked_to_type,
        linkedToKey: input.linked_to_key,
        runId: input.run_id,
      });
      return { artifact_id: created.id, content_ref: created.contentRef };
    },
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
  ...REQUEST_TOOLS,
  ...PROJECT_TOOLS,
  ...WORK_ITEM_TOOLS,
  ...ORGANISATION_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...SKILL_TOOLS,
  ...CONNECTOR_TOOLS,
  ...ENGAGE_TOOLS,
  ...FILE_TOOLS,
  ...MEMORY_TOOLS,
  ...INTEGRATION_TOOLS,
  ...BUDGET_TOOLS,
  ...GOVERNANCE_TOOLS,
  ...AGENT_TOOLS,
  ...ROOM_TOOLS,
  ...SCHEDULE_TOOLS,
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
