import { eq } from "drizzle-orm";

import { BUILTIN_AGENT_CODE, BUILTIN_DEFAULT_VERSION, BUILTIN_DEFAULTS } from "@/features/agents/builtin";
import { DEFAULT_TOOL_GRANT } from "@/features/agents/run-payload";
import type { Database } from "../client";
import * as s from "../schema";
import { AGENTS, ORG, PEOPLE } from "./data/people";
import { CONNS0 } from "./data/connectors";
import { SKILLS } from "./data/skills";
import { shift } from "./clock";
import { ids } from "./ids";

/**
 * Data model section 10: the agents, their published versions and what each version may
 * reach — skills, tool modes, memory scopes and knowledge collections.
 */

/** The prototype's profile words, mapped to the seven execution profiles of specification 5.2. */
const PROFILE: Record<string, string> = {
  planner: "Planner",
  task: "Task",
  conversational: "Conversational",
  workbench: "Triage",
  reviewer: "Reviewer",
  routine: "Routine",
  scripted: "Scripted",
};

/**
 * The route each agent runs on. An agent's model is the first step of its primary route,
 * so the Agents screen reads the model from the route rather than from a column of its own.
 */
const ROUTE_OF: Record<string, [primary: string, fallback: string | null]> = {
  exp: ["reasoning-default", "small-fast"],
  sup: ["small-fast", "reasoning-default"],
  prc: ["vision", "reasoning-default"],
  bug: ["reasoning-default", "small-fast"],
  rec: ["local-private", null],
  kb: ["small-fast", null],
  // Answers a person while they wait, so the fast route leads and reasoning catches what
  // it cannot.
  pa: ["small-fast", "reasoning-default"],
  def: ["small-fast", "reasoning-default"],
};

const TRUST_OF: Record<string, string> = {
  exp: "Standard",
  sup: "Restricted",
  prc: "Standard",
  bug: "Standard",
  rec: "Elevated",
  kb: "Standard",
  // Reads only, and only what the person asking may already see.
  pa: "Restricted",
  def: "Standard",
};

const INSTRUCTIONS: Record<string, string> = {
  // The built-in Assistant is seeded from the same defaults "Reset to defaults" restores.
  pa: BUILTIN_DEFAULTS.instructions,
  def:
    "Answer from the default knowledge base, and plan or triage a request or a work item when " +
    "one is assigned to you. Before you work a request's or a work item's step, call " +
    "`request_read` or `work_item_read` on the key the task frame names and read its details, " +
    "its attachments and its whole history — the previous steps' comments are where the " +
    "decision you are being asked for usually already has its answer. Use `file_search` to find " +
    "an attachment, and `knowledge_search` for anything the organisation's documents answer; " +
    "leave `collection_id` out to search every collection you are granted. Then choose the tool " +
    "the step actually needs rather than answering from general knowledge.",
  exp: "Review an employee expense claim against FIN-POL-007 and recommend approve or return, citing the clause for every finding.",
  sup: "Help a customer with card and account questions. Follow the storyline exactly where one is set. Hand off to a person when the visitor asks.",
  prc: "Plan a purchase: collect quotes, score them against the criteria and recommend one with reasons.",
  bug: "Triage an incoming defect: set severity, reproduce in the sandbox and attach the evidence.",
  rec: "Reconcile the bank statement against the ledger and raise an exception for every unmatched line.",
  kb: "Keep the knowledge collections current: re-ingest what has changed and flag what has gone stale.",
};

/** Which skills each agent version carries, and which tools it may call without asking. */
const AGENT_SKILLS: Record<string, string[]> = {
  exp: ["expense-claim-review", "receipt-extraction", "policy-lookup", "work-item-execution"],
  sup: ["receipt-extraction", "bilingual-writing"],
  prc: ["work-item-execution"],
  bug: ["defect-report", "work-item-execution"],
  rec: ["work-item-execution"],
  kb: ["policy-lookup", "bilingual-writing"],
  pa: [...BUILTIN_DEFAULTS.skills],
  def: ["task-planning", "work-item-execution", "bilingual-writing", "request-triage", "platform-operations"],
};

const AGENT_TOOLS: Record<string, string[]> = {
  exp: ["erp/claims.read", "erp/claims.update_status", "knowledge/search"],
  sup: ["cards/get_status", "cards/block", "cards/replace", "knowledge/search"],
  prc: ["erp/vendors.search", "erp/purchase_order.submit"],
  bug: ["sandbox-fs/read_file", "sandbox-fs/write_file"],
  rec: ["erp/claims.read", "erp/payments.release"],
  kb: ["knowledge/search", "knowledge/graph.query"],
  // No connector tools. It reads through the platform MCP server, under the run token of
  // the person who opened it, which is what keeps it from seeing anything they cannot.
  pa: [],
  def: [],
};

/** The agent every install needs regardless of demo business data: the page assistant every
 * screen opens. */
export const SYSTEM_AGENT_IDS = ["pa"] as const;

const versionNumber = (ver: string) => Number(ver.replace(/^v/, ""));

/**
 * Inserts the given agents (the demo set by default) with their active version and, for an agent
 * past v1, the previous one for rollback; then each version's platform tool grant (the built-in
 * Assistant's own defaults, `DEFAULT_TOOL_GRANT` for the rest), the active version's skills that
 * were seeded, and its connector tools that exist in `connectors`, at Auto, Approval or Denied by
 * tier.
 */
export async function seedAgents(
  db: Database,
  options: { agents?: typeof AGENTS; connectors?: typeof CONNS0 } = {},
): Promise<void> {
  const agents = options.agents ?? AGENTS;
  const connectors = options.connectors ?? CONNS0;

  await db.insert(s.agent).values(
    agents.map((a) => {
      const node = ORG.find((o) => o.id === a.id);
      const parent = node?.parent ?? null;
      const parentIsPerson = PEOPLE.some((p) => p.id === parent);
      return {
        id: ids.agent(a.id),
        code: a.id,
        nameEn: a.name,
        nameAr: a.nameAr,
        initials: a.ini,
        orgUnitId: ids.orgUnit(a.unit),
        reportsToType: parent ? (parentIsPerson ? "Person" : "Agent") : null,
        reportsToId: parent ? (parentIsPerson ? ids.person(parent) : ids.agent(parent)) : null,
        isSystem: (SYSTEM_AGENT_IDS as readonly string[]).includes(a.id),
        // D65: the one agent the platform ships and depends on. `is_system` says the
        // platform ships an agent for its own use; this says the product breaks without it.
        isBuiltin: a.id === BUILTIN_AGENT_CODE,
        defaultVersion: a.id === BUILTIN_AGENT_CODE ? BUILTIN_DEFAULT_VERSION : null,
        status: a.status === "Draft" ? "Idle" : a.status,
      };
    }),
  );

  await db.insert(s.agentVersion).values(
    agents.flatMap((a) => {
      const current = versionNumber(a.ver);
      const [primary, fallback] = ROUTE_OF[a.id];
      const active = {
        id: ids.agentVersion(`${a.id}:${current}`),
        agentId: ids.agent(a.id),
        versionNumber: current,
        instructions: INSTRUCTIONS[a.id],
        executionProfile: PROFILE[a.profile],
        primaryRouteId: ids.route(primary),
        fallbackRouteId: fallback ? ids.route(fallback) : null,
        trust: TRUST_OF[a.id],
        memoryEnabled: true,
        // No money ceiling. A run stops when the work is done, when a limit on *effort*
        // is reached, or when a person stops it — not part-way through a correct mission
        // because an estimate crossed a number. Zero is "no limit" to the harness, so the
        // cost is still estimated and recorded, just not enforced.
        runBudgetSoftAed: 0,
        runBudgetHardAed: 0,
        releaseNotes: "Current published version.",
        evalScore: 4.5,
        publishedAt: shift("2026-10-01T06:00:00Z"),
        publishedBy: ids.person("u4"),
        isActive: true,
      };
      if (current === 1) return [active];
      return [
        {
          ...active,
          id: ids.agentVersion(`${a.id}:${current - 1}`),
          versionNumber: current - 1,
          releaseNotes: "Previous version, kept for rollback.",
          evalScore: 4.2,
          publishedAt: shift("2026-08-01T06:00:00Z"),
          isActive: false,
        },
        active,
      ];
    }),
  );

  for (const a of agents) {
    await db
      .update(s.agent)
      .set({ activeVersionId: ids.agentVersion(`${a.id}:${versionNumber(a.ver)}`) })
      .where(eq(s.agent.id, ids.agent(a.id)));
  }

  // D38: every version carries its grant explicitly. The seed grants the default, the
  // same list a new agent is created with and the same one migration 0034 backfilled, so
  // a seeded install and a migrated one answer "what may this agent reach" identically.
  // The built-in Assistant carries its own defaults, which add the agent tools (D254).
  const grants = agents.flatMap((a) => {
    const current = versionNumber(a.ver);
    const versions =
      current === 1
        ? [ids.agentVersion(`${a.id}:${current}`)]
        : [ids.agentVersion(`${a.id}:${current - 1}`), ids.agentVersion(`${a.id}:${current}`)];
    const tools = a.id === BUILTIN_AGENT_CODE ? BUILTIN_DEFAULTS.tools : DEFAULT_TOOL_GRANT;
    return versions.flatMap((agentVersionId) => tools.map((toolName) => ({ agentVersionId, toolName })));
  });
  await db.insert(s.agentPlatformTool).values(grants);

  const agentSkills = agents.flatMap((a) =>
    AGENT_SKILLS[a.id]
      .filter((name) => SKILLS.some((skill) => skill.n === name))
      .map((name) => ({
        agentVersionId: ids.agentVersion(`${a.id}:${versionNumber(a.ver)}`),
        skillVersionId: ids.skillVersion(name),
      })),
  );
  if (agentSkills.length > 0) await db.insert(s.agentSkill).values(agentSkills);

  const toolModes = agents.flatMap((a) =>
    AGENT_TOOLS[a.id]
      .filter((ref) => {
        const [connector, tool] = ref.split("/");
        return connectors.some((c) => c.n === connector && c.tools.some(([name]) => name === tool));
      })
      .map((ref) => {
        const [, tool] = ref.split("/");
        const connector = connectors.find((c) => c.tools.some(([name]) => name === tool) && ref.startsWith(`${c.n}/`));
        const tier = connector?.tools.find(([name]) => name === tool)?.[1];
        return {
          agentVersionId: ids.agentVersion(`${a.id}:${versionNumber(a.ver)}`),
          connectorToolId: ids.connectorTool(ref),
          mode: tier === "T3" ? "Denied" : tier === "T2" ? "Approval" : "Auto",
        };
      }),
  );
  if (toolModes.length > 0) await db.insert(s.agentToolMode).values(toolModes);
}
