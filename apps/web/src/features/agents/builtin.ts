import { BUILTIN_ONLY_PLATFORM_TOOLS } from "./default-tools";
import { DEFAULT_TOOL_GRANT } from "./run-payload";

/**
 * The Platform Assistant: the one agent the platform ships and depends on (D65).
 *
 * The AI Assistant panel always runs it, so it cannot be deleted — the server refuses
 * and the UI hides the action. Everything else about it is configuration: skills, tools,
 * knowledge, memory, model, budgets and extra instructions all change like any other
 * agent's. Only its existence is fixed.
 *
 * These are its *defaults*, in one place, read by three callers that would otherwise
 * each hold their own copy: the seed that creates it, "reset to defaults" that restores
 * it, and the seed upgrade that moves the defaults forward. A person who has customised
 * the agent keeps their customisation across an upgrade, because the upgrade compares
 * `defaultVersion` rather than the configuration itself.
 */

/** The code the panel resolves. Fixed, because the panel is written against it. */
export const BUILTIN_AGENT_CODE = "pa";

/**
 * Which generation of the defaults below an agent was last created from or reset to.
 *
 * Raise it when the defaults change in a way existing installations should pick up. The
 * seed then upgrades an agent still sitting on an older number and leaves alone one a
 * person has since customised.
 */
export const BUILTIN_DEFAULT_VERSION = 4;

/**
 * The parts of the Assistant a reset restores.
 *
 * Deliberately not everything the agent row holds: its runs, its memory and its audit
 * trail are history, not configuration, and a reset must not erase them.
 */
export type BuiltinDefaults = {
  instructions: string;
  /** Platform tools, connector tools and harness-answered built-ins alike (D80). */
  tools: readonly string[];
  /** Bundled Agent Skills, by name. */
  skills: readonly string[];
  /** 0 means no ceiling, which is what the platform runs with (D73). */
  budgetSoftAed: number;
  budgetHardAed: number;
};

/**
 * The agent tools the Assistant holds beyond the default grant (D254): T2, so each call waits
 * for a holder of `approvals:decide` other than the person asking (D253).
 */
export const BUILTIN_AGENT_TOOLS = [
  "agent_create",
  "agent_edit",
  "agent_tool_grant_edit",
  "agent_skill_edit",
  "agent_knowledge_access_edit",
  "agent_memory_access_edit",
  "agent_trust_edit",
  "agent_run_budget_edit",
  "agent_publish",
  "agent_rollback",
  "agent_delete",
] as const;

export const BUILTIN_DEFAULTS: BuiltinDefaults = {
  instructions:
    "You are the Platform Assistant. You work on behalf of the person asking, with their " +
    "permissions and no more. " +
    "Read the screen they are on before answering a question about it, and name real " +
    "records rather than describing what you would do. " +
    "You can carry out work, not only advise: when someone asks for something that needs " +
    "several steps, plan them and do them, then say what you did. " +
    "Ask for what you are missing in one message, as specific questions with a sensible " +
    "default for each, rather than announcing that something is missing. " +
    "A refusal is an answer: if the platform refuses a call, say plainly whether it is " +
    "because the person may not do it, because you were not granted the tool, or because " +
    "it needs somebody's approval — and never retry against a wall. " +
    "To summarise or answer about the page, call `page_read` with the page the task frame " +
    "names and summarise what it returns. Asked what needs attention, call `my_attention` " +
    "and answer with its entries in order, each with its link and why it is waiting. " +
    "For one request or work item, call `request_read` or `work_item_read` first. " +
    "For a question the organisation's own documents answer, call `knowledge_search`; leave " +
    "its `collectionId` out to search everything you are granted. " +
    "Before creating or configuring anything on the platform, follow the " +
    "`guided-platform-creation` instructions below.",
  // D376: updating an installed skill, and D381: deleting an invited or suspended person, both
  // T2 like the agent tools, so each call waits for an approval.
  tools: [...DEFAULT_TOOL_GRANT, ...BUILTIN_ONLY_PLATFORM_TOOLS, ...BUILTIN_AGENT_TOOLS, "skill_version_create", "person_delete"],
  skills: ["guided-platform-creation", "platform-operations"],
  budgetSoftAed: 0,
  budgetHardAed: 0,
};
